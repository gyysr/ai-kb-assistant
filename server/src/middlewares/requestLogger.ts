import type { NextFunction, Request, Response } from 'express';
import { logger } from '../services/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    if (path === '/api/health') return;
    logger.info(
      {
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Date.now() - start,
        user: req.user?.username ?? null,
      },
      'request',
    );
  });
  next();
}
