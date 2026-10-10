import { config } from '../config';
import { searchKnowledge, type RetrievedChunk } from './retrieval';
import { isWebSearchConfigured, webSearch, type WebResult } from './webSearch';
import type { ToolSchema } from './qwenChat';

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

export interface ToolOutcome {
  summary: string;
  sources: Omit<SourceItem, 'index'>[];
}

export function toolSchemas(): ToolSchema[] {
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

export async function executeTool(
  name: string,
  rawArgs: string,
  startIndex: number,
): Promise<ToolOutcome> {
  let args: { query?: string };
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
