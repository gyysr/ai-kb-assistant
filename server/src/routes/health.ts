// ===== 健康检查路由：回答"服务还活着吗" =====
// 给机器探活用的，不是给用户用的：Docker healthcheck 和 nginx 都会定时请求它，
// 一旦超时或报错，容器会被判为不健康、负载均衡会把它摘出集群。
// 因此这个接口必须极轻：只读进程自身状态，不碰数据库也不调外部服务
import { Router } from 'express';
import { ok } from '../utils/response';

export const healthRouter = Router();

// GET /api/health —— 谁都能访问、永远秒回。
// 参数名 _req 加下划线 = "这个参数用不上，但函数签名要求占位"
healthRouter.get('/health', (_req, res) => {
  // uptime 是进程已存活的秒数：排查时一眼能看出服务是不是刚重启过
  res.json(
    ok({
      status: 'up',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    }),
  );
});
