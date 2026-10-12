// GET /api/usage —— 前端顶部"联网搜索 剩余/1000"徽标的数据来源。
// 带缓存地透传 Tavily 官方的 /usage 接口（见 webSearch.ts），
// 并额外给一个 enabled 字段：后端没配 Key 时前端干脆不显示徽标
import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { getTavilyUsage, isWebSearchConfigured } from '../services/webSearch';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';

export const usageRouter = Router();

usageRouter.get(
  '/usage',
  // 登录即可看（额度是账号级的，不涉及敏感数据，无需 admin）
  requireAuth,
  // asyncHandler：把 async 函数的异常转给统一错误处理器，否则未捕获的
  // reject 会让请求悬着直到超时
  asyncHandler(async (_req, res) => {
    const tavily = await getTavilyUsage();
    // ...(tavily ?? {})：拿到就展开 plan/used/limit，没拿到就只剩 enabled
    res.json(
      ok({
        webSearch: {
          enabled: isWebSearchConfigured(),
          ...(tavily ?? {}),
        },
      }),
    );
  }),
);
