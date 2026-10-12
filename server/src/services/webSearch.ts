// ===== Tavily 联网搜索封装 =====
// Tavily 是专门给 AI 应用用的搜索 API：你给它一个问题，它返回整理好的
// 网页摘要（而不是一堆 HTML），模型直接就能读。
// Key 放 server/.env（本地）和服务器 /opt/ai-kb-assistant/.env（root:600），
// 均已 gitignore，绝不进代码仓库
import { config } from '../config';

// 单条网页搜索结果：标题、链接、摘要、相关度分数
export interface WebResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

// 只声明我们关心的字段（Tavily 实际返回更多，TS 允许省略）
interface TavilyResponse {
  results?: { title?: string; url?: string; content?: string; score?: number }[];
}

// 是否配置了 Tavily Key —— agent.ts 据此决定给不给模型挂 web_search 工具
export function isWebSearchConfigured(): boolean {
  return Boolean(config.webSearch.tavilyApiKey);
}

// Tavily 账号用量（用于前端"联网搜索 剩余/1000"徽标）
export interface TavilyUsage {
  plan: string;
  used: number;
  limit: number | null;
}

// /usage 是平台级接口但配额按账号计，60s 缓存避免每次页面加载都打 Tavily。
// 注意 Tavily 的 plan_usage 统计有延迟（刚搜完可能还显示 0），属正常现象
let usageCache: { at: number; data: TavilyUsage | null } | null = null;
const USAGE_CACHE_TTL = 60_000;

// 查询 Tavily 账号用量：GET /usage + Bearer 认证。
// 任何失败都返回 null（徽标只是体验功能，绝不能拖垮主流程）
export async function getTavilyUsage(): Promise<TavilyUsage | null> {
  if (!isWebSearchConfigured()) return null;
  // 命中缓存直接返回（60 秒内点刷新按钮也只会拿到缓存值）
  if (usageCache && Date.now() - usageCache.at < USAGE_CACHE_TTL) return usageCache.data;
  try {
    const res = await fetch('https://api.tavily.com/usage', {
      headers: { Authorization: `Bearer ${config.webSearch.tavilyApiKey}` },
      // 8 秒拿不到就放弃，不给用户等待感
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

// 执行一次联网搜索：POST /search，Key 放请求体（Tavily 两种认证方式之一）
export async function webSearch(query: string, maxResults = 5): Promise<WebResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: config.webSearch.tavilyApiKey,
      query,
      max_results: maxResults,
      // basic 深度足够问答用，便宜且快；advanced 更准但更贵
      search_depth: 'basic',
      // 不让 Tavily 自己生成摘要回答，我们只要原始网页片段
      include_answer: false,
    }),
    // 15 秒超时：模型在 agent 循环里等着它，不能无限等
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    // 把响应体前 120 字附进错误信息，方便日志排查（4xx 常见：Key 无效/额度用尽）
    const body = await res.text();
    throw new Error(`Tavily 响应异常: ${res.status} ${body.slice(0, 120)}`);
  }
  const data = (await res.json()) as TavilyResponse;
  // 字段逐个兜底缺省值，上游少字段也不会导致 undefined 渲染到界面上
  return (data.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    content: r.content ?? '',
    score: r.score ?? 0,
  }));
}
