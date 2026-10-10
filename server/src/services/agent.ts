import { config } from '../config';
import {
  streamChatCompletion,
  type ChatMessage,
  type ToolCall,
  type ToolSchema,
  type Usage,
} from './qwenChat';
import { executeTool, toolSchemas, type SourceItem } from './tools';

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

const SYSTEM_PROMPT = [
  '你是一个严谨的企业知识库问答助手，可以调用工具获取信息后再回答问题。',
  '工具说明：',
  '- search_knowledge：检索企业知识库（用户上传的内部文档）。',
  '- web_search：联网搜索公开网页（如可用），仅在知识库无法回答且问题需要实时或外部信息时使用。',
  '规则：',
  '1. 回答前先用 search_knowledge 检索知识库，再根据检索结果决定是否需要补充调用其他工具。',
  '2. 工具返回的内容按 [1] [2] 编号（跨多次工具调用编号连续），回答时用对应编号标注引用来源。',
  '3. 只依据工具返回的内容回答，不要编造。',
  '4. 知识库没有相关内容时：若属于通用常识，可直接回答，并在结尾注明"（以下回答来自模型通用知识，仅供参考，未引用知识库）"；若问题需要实时信息（天气、新闻、股价等），明确说明暂时无法获取实时数据。',
  '5. 回答简洁、准确，使用中文。',
].join('\n');

function addUsage(total: Usage | null, u: Usage): Usage {
  if (!total) return u;
  return {
    promptTokens: total.promptTokens + u.promptTokens,
    completionTokens: total.completionTokens + u.completionTokens,
    totalTokens: total.totalTokens + u.totalTokens,
  };
}

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
  const maxToolRounds = Math.max(1, config.agent.maxToolRounds);

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: question },
  ];

  const sources: SourceItem[] = [];
  let usage: Usage | null = null;

  for (let round = 0; ; round++) {
    const withTools = round < maxToolRounds;
    let calls: ToolCall[] = [];

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

    if (calls.length === 0 || !withTools) {
      return { usage, sources, rounds: round + 1 };
    }

    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: calls.map((c, i) => ({
        id: c.id || `call_${round}_${i}`,
        type: 'function',
        function: { name: c.name, arguments: c.arguments },
      })),
    });

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const args = parseArgs(call.arguments);
      cb.onToolStart?.(call.name, args);

      const outcome = await executeTool(call.name, call.arguments, sources.length);
      sources.push(...outcome.sources.map((s, j) => ({ ...s, index: sources.length + j + 1 })));
      cb.onSources?.(sources);
      cb.onToolEnd?.(call.name, args);

      messages.push({
        role: 'tool',
        tool_call_id: call.id || `call_${round}_${i}`,
        content: outcome.summary,
      });
    }
  }
}
