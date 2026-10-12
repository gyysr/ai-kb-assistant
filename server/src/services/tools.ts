// ===== Agent 工具箱：给模型看的"工具说明书" + 真正执行工具的两半逻辑 =====
// toolSchemas() 按 OpenAI function calling 协议的格式描述可用工具，模型据此
// 决定"要不要调、传什么参数"；executeTool() 在模型发起调用后真正执行
// （查知识库 / 联网搜索）并返回摘要与来源列表。由 services/agent.ts 的
// Agent 循环驱动；说明书类型 ToolSchema 定义在 qwenChat.ts。
import { config } from '../config';
import { searchKnowledge, type RetrievedChunk } from './retrieval';
import { isWebSearchConfigured, webSearch, type WebResult } from './webSearch';
import type { ToolSchema } from './qwenChat';

// 一条"引用来源"：前端引用面板按 index 序号展示成 [1][2]…；kind 区分来自知识库还是网页
export interface SourceItem {
  index: number;
  kind: 'kb' | 'web';
  documentId?: number;
  filename: string;
  chunkIndex?: number;
  url?: string;
  score: number;
  snippet: string;
  content: string;
}

// 工具执行结果：summary 是拼好的文本（喂回给模型当上下文），sources 给前端展示引用
export interface ToolOutcome {
  summary: string;
  sources: Omit<SourceItem, 'index'>[];
}

// "工具说明书"：函数名 + 描述 + 参数的 JSON Schema，说明书写得越清楚模型调用越准——
// 模型只会照着说明书挑工具、编参数，真正执行发生在后端的 executeTool 里
export function toolSchemas(): ToolSchema[] {
  // 知识库检索：不依赖外部 Key，永远在说明书里
  const tools: ToolSchema[] = [
    {
      type: 'function',
      function: {
        name: 'search_knowledge',
        description: '检索企业知识库（用户上传的内部文档），返回与查询最相关的文档片段。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '检索关键词或问题' },
          },
          required: ['query'],
        },
      },
    },
  ];
  // web_search 只在配了 TAVILY_API_KEY 时才写进说明书：模型看不到就不会调用，
  // 避免它去调一个实际不可用的工具
  if (isWebSearchConfigured()) {
    tools.push({
      type: 'function',
      function: {
        name: 'web_search',
        description: '联网搜索公开网页，获取实时信息或知识库中没有的外部资料。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
          },
          required: ['query'],
        },
      },
    });
  }
  return tools;
}

// 知识库块 → 统一的来源格式：score 保留 4 位小数；snippet 截 120 字给前端列表当预览
function kbToSources(chunks: RetrievedChunk[]): Omit<SourceItem, 'index'>[] {
  return chunks.map((c) => ({
    kind: 'kb' as const,
    documentId: c.document_id,
    filename: c.filename,
    chunkIndex: c.chunk_index,
    score: Number(c.score.toFixed(4)),
    snippet: c.content.slice(0, 120) + (c.content.length > 120 ? '…' : ''),
    content: c.content,
  }));
}

// 网页结果 → 统一来源格式：网页正文只截 600 字，防止超长页面撑爆模型上下文
function webToSources(results: WebResult[]): Omit<SourceItem, 'index'>[] {
  return results.map((r) => ({
    kind: 'web' as const,
    filename: r.title || r.url,
    url: r.url,
    score: Number(r.score.toFixed(4)),
    snippet: r.content.slice(0, 160) + (r.content.length > 160 ? '…' : ''),
    content: r.content.slice(0, 600),
  }));
}

// 执行模型点名的工具：rawArgs 是模型拼出来的 JSON 字符串，先解析再干活
export async function executeTool(
  name: string,
  rawArgs: string,
  startIndex: number,
): Promise<ToolOutcome> {
  let args: { query?: string };
  // 参数不合法不抛异常，而是把错误当"工具返回"喂回模型让它重试——Agent 循环的容错方式
  try {
    args = JSON.parse(rawArgs || '{}') as { query?: string };
  } catch {
    return { summary: '错误：工具参数不是合法 JSON，请重新调用。', sources: [] };
  }
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return { summary: '错误：缺少 query 参数。', sources: [] };
  }

  if (name === 'search_knowledge') {
    // 每条来源带 [序号] 前缀并标注文档名与第几段，模型回答时能据此标注引用
    const chunks = await searchKnowledge(query, config.rag.topK);
    const sources = kbToSources(chunks);
    const summary = sources.length
      ? sources
          .map(
            (s, i) =>
              `[${startIndex + i + 1}] 来源：${s.filename}（第 ${(s.chunkIndex ?? 0) + 1} 段）\n${s.content}`,
          )
          .join('\n\n')
      : '（知识库中没有找到与该查询相关的内容）';
    return { summary, sources };
  }

  if (name === 'web_search') {
    // 双保险：即使模型"幻觉"调用了未配置的工具，也返回错误文案而不是让请求崩掉
    if (!isWebSearchConfigured()) {
      return { summary: '错误：web_search 未配置（缺少 TAVILY_API_KEY），无法联网搜索。', sources: [] };
    }
    try {
      const results = await webSearch(query);
      const sources = webToSources(results);
      const summary = sources.length
        ? sources
            .map((s, i) => `[${startIndex + i + 1}] ${s.filename}\n链接：${s.url}\n${s.content}`)
            .join('\n\n')
        : '（网络搜索没有返回结果）';
      return { summary, sources };
    } catch (err) {
      return { summary: `错误：网络搜索失败（${(err as Error).message}）。`, sources: [] };
    }
  }

  return { summary: `错误：未知工具 ${name}。`, sources: [] };
}
