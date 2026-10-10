import { Router } from 'express';
import { ok } from '../utils/response';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json(
    ok({
      status: 'up',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    }),
  );
});
