import { config } from '../config';

export interface WebResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results?: { title?: string; url?: string; content?: string; score?: number }[];
}

export function isWebSearchConfigured(): boolean {
  return Boolean(config.webSearch.tavilyApiKey);
}

export async function webSearch(query: string, maxResults = 5): Promise<WebResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: config.webSearch.tavilyApiKey,
      query,
      max_results: maxResults,
      search_depth: 'basic',
      include_answer: false,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Tavily 响应异常: ${res.status} ${body.slice(0, 120)}`);
  }
  const data = (await res.json()) as TavilyResponse;
  return (data.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    content: r.content ?? '',
    score: r.score ?? 0,
  }));
}
