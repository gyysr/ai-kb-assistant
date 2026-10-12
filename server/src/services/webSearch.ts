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

export interface TavilyUsage {
  plan: string;
  used: number;
  limit: number | null;
}

// /usage 是平台级接口但配额按账号计，60s 缓存避免每次页面加载都打 Tavily
let usageCache: { at: number; data: TavilyUsage | null } | null = null;
const USAGE_CACHE_TTL = 60_000;

export async function getTavilyUsage(): Promise<TavilyUsage | null> {
  if (!isWebSearchConfigured()) return null;
  if (usageCache && Date.now() - usageCache.at < USAGE_CACHE_TTL) return usageCache.data;
  try {
    const res = await fetch('https://api.tavily.com/usage', {
      headers: { Authorization: `Bearer ${config.webSearch.tavilyApiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      account?: { current_plan?: string; plan_usage?: number; plan_limit?: number | null };
    };
    const usage: TavilyUsage = {
      plan: data.account?.current_plan ?? '',
      used: data.account?.plan_usage ?? 0,
      limit: data.account?.plan_limit ?? null,
    };
    usageCache = { at: Date.now(), data: usage };
    return usage;
  } catch {
    // 查询失败也短缓存，防止前端反复触发打爆接口
    usageCache = { at: Date.now(), data: null };
    return null;
  }
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
