// ===== 请求日志中间件：每个请求结束时记一行 方法/路径/状态码/耗时/操作人 =====
// 在 app.ts 里挂在所有路由之前；输出走 services/logger.ts 的双通道。
// 与 services/audit.ts 分工：这里记技术流水供排查，那边记用户敏感行为供追责。
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../services/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  // 不能在请求进来时记——那时路由还没执行，拿不到状态码和耗时；
  // finish 事件 = 响应已发送完毕，此刻补记最准
  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    // 探活接口排除：Docker/K8s 每隔几秒就 ping 一次 /api/health，不排除会被它刷满日志
    if (path === '/api/health') return;
    logger.info(
      {
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Date.now() - start,
        // 若请求已通过 requireAuth，这里能带上操作人，事后好查"是谁干的"
        user: req.user?.username ?? null,
      },
      'request',
    );
  });
  next();
}
