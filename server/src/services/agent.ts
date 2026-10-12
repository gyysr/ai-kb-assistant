// ===== Agent 循环：让大模型"自己决定"调不调工具、调几次 =====
// 一轮的流程：把对话历史发给模型 → 模型要么直接吐文字（结束），要么吐
// tool_calls（要调工具）→ 服务器执行工具、把结果塞回对话历史 → 再问模型
// → 循环，直到模型不再要工具（或达到最大轮数兜底防死循环）
import { config } from '../config';
import {
  streamChatCompletion,
  type ChatMessage,
  type ToolCall,
  type ToolSchema,
  type Usage,
} from './qwenChat';
import { executeTool, toolSchemas, type SourceItem } from './tools';
import { isWebSearchConfigured } from './webSearch';

// 流式回调：前端 SSE 的 tool/delta/sources 事件就是从这里发的
export interface AgentCallbacks {
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  onToolEnd?: (name: string, args: Record<string, unknown>) => void;
  onSources?: (sources: SourceItem[]) => void;
  onDelta?: (content: string) => void;
}

export interface AgentResult {
  usage: Usage | null;
  sources: SourceItem[];
  rounds: number;
}

// 工具是否注册取决于运行时配置，提示词同步声明，避免模型误判"工具不可用"而拒答。
// 教训：曾用"（如可用）"这种模糊措辞，配了 Key 的模型反而谎称工具不可用拒答 —— 模型
// 会过度解读提示词，可用/不可用必须在启动时就写成定论
const webAvailable = isWebSearchConfigured();

// 系统提示词：给模型立的"岗位说明书"。规则 6/7 分别引导它输出表格/代码块、
// echarts 图表 JSON —— 前端渲染器都是为这些格式量身写的
const SYSTEM_PROMPT = [
  '你是一个严谨的企业知识库问答助手，可以调用工具获取信息后再回答问题。',
  '工具说明：',
  '- search_knowledge：检索企业知识库（用户上传的内部文档）。',
  webAvailable
    ? '- web_search：联网搜索公开网页。知识库无法回答、或问题需要实时信息（行情、新闻、天气等）时必须调用它，不要凭记忆编造实时数据，也不要声称工具不可用。'
    : '- web_search：联网搜索公开网页（当前未配置，不可用）。',
  '规则：',
  '1. 回答前先用 search_knowledge 检索知识库，再根据检索结果决定是否需要补充调用其他工具。',
  '2. 工具返回的内容按 [1] [2] 编号（跨多次工具调用编号连续），回答时用对应编号标注引用来源。',
  '3. 只依据工具返回的内容回答，不要编造。',
  webAvailable
    ? '4. 知识库没有相关内容时：若属于通用常识，可直接回答，并在结尾注明"（以下回答来自模型通用知识，仅供参考，未引用知识库）"；若问题需要实时信息（天气、新闻、股价、金价等），调用 web_search 获取后依据结果回答。'
    : '4. 知识库没有相关内容时：若属于通用常识，可直接回答，并在结尾注明"（以下回答来自模型通用知识，仅供参考，未引用知识库）"；若问题需要实时信息（天气、新闻、股价等），明确说明暂时无法获取实时数据。',
  '5. 回答简洁、准确，使用中文。',
  '6. 输出格式：使用 Markdown。罗列或对比多项结构化信息（规格、规则、步骤汇总等）时优先用表格；涉及命令、配置、代码时用代码块（```语言 开头）；行内参数或字段用行内代码。',
  '7. 需要数据可视化时（趋势、占比、对比），输出 ```echarts 围栏代码块，内容为 ECharts option 的严格 JSON：不要 JS 赋值语句、不要注释、不要逗号尾缀，series 数据嵌在 JSON 里。数据必须来自工具返回；若确需示例数据，正文须注明"（示例数据）"。每个回答最多 1 个图表，先给一句话说明再放图表。',
].join('\n');

// token 用量累加：agent 可能跑好几轮，每轮模型各报一份 usage，加总才是这次回答的真实成本
function addUsage(total: Usage | null, u: Usage): Usage {
  if (!total) return u;
  return {
    promptTokens: total.promptTokens + u.promptTokens,
    completionTokens: total.completionTokens + u.completionTokens,
    totalTokens: total.totalTokens + u.totalTokens,
  };
}

// 模型输出的工具参数是"JSON 字符串"（OpenAI 风格），解析失败时退化为 {raw}，
// 至少前端还能把原文展示出来而不是整个崩掉
function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : { raw };
  } catch {
    return { raw };
  }
}

export async function runAgent(
  question: string,
  opts: { signal?: AbortSignal; callbacks?: AgentCallbacks } = {},
): Promise<AgentResult> {
  const cb = opts.callbacks ?? {};
  const tools = toolSchemas();
  // 最大工具轮数兜底：万一模型陷入"调工具→不满意→再调"的死循环，到次数就不再给它工具
  const maxToolRounds = Math.max(1, config.agent.maxToolRounds);

  // 对话历史：系统提示词 + 用户问题开局。之后每轮追加 assistant 的工具调用
  // 和工具结果 —— 这就是"多轮上下文"，模型靠它知道之前查过什么
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: question },
  ];

  // 全程累积的引用来源（跨多轮工具调用编号连续，[1][2][3]…）
  const sources: SourceItem[] = [];
  let usage: Usage | null = null;

  for (let round = 0; ; round++) {
    // 超过最大轮数后不再下发工具列表 —— 模型拿不到工具就只能老实写回答了
    const withTools = round < maxToolRounds;
    let calls: ToolCall[] = [];

    // 流式调用千问。事件两种：text（文字片段，直通前端）、toolCalls（要调工具）
    for await (const event of streamChatCompletion(messages, {
      signal: opts.signal,
      tools: withTools ? tools : undefined,
      onUsage: (u) => {
        usage = addUsage(usage, u);
      },
    })) {
      if (event.type === 'text') {
        cb.onDelta?.(event.content);
      } else {
        calls = event.calls;
      }
    }

    // 模型没要工具（或已到轮数上限）：回答结束，return 走出循环
    if (calls.length === 0 || !withTools) {
      return { usage, sources, rounds: round + 1 };
    }

    // 把"模型要求调用工具"这条记录原样写回对话历史（OpenAI 协议要求，
    // 下一条 tool 消息必须能对上 tool_call_id，缺了模型会报错）
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: calls.map((c, i) => ({
        id: c.id || `call_${round}_${i}`,
        type: 'function',
        function: { name: c.name, arguments: c.arguments },
      })),
    });

    // 逐个执行本轮的工具调用（模型一次可能并行要多个）
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const args = parseArgs(call.arguments);
      cb.onToolStart?.(call.name, args);

      // 执行工具（检索知识库 / 联网搜索），返回新来源 + 摘要文本
      const outcome = await executeTool(call.name, call.arguments, sources.length);
      // 新来源追加进总列表，index 就是回答里 [n] 的 n —— 从已有数量往后排，
      // 保证跨轮次编号不重不漏
      sources.push(...outcome.sources.map((s, j) => ({ ...s, index: sources.length + j + 1 })));
      cb.onSources?.(sources);
      cb.onToolEnd?.(call.name, args);

      // 工具结果也写回对话历史，模型下一轮就是"看着这些结果"写回答
      messages.push({
        role: 'tool',
        tool_call_id: call.id || `call_${round}_${i}`,
        content: outcome.summary,
      });
    }
  }
}
