import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { getTavilyUsage, isWebSearchConfigured } from '../services/webSearch';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';

export const usageRouter = Router();

usageRouter.get(
  '/usage',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const tavily = await getTavilyUsage();
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
