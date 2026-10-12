// ===== Express 应用组装：把中间件和路由拼成一个完整后端 =====
// Express 的核心概念是"中间件"（middleware）：app.use() 注册的函数会按注册
// 顺序依次执行，一个请求像过流水线一样穿过它们。所以这里的书写顺序=执行顺序：
// 解析/日志在前 → 业务路由居中 → 兜底错误处理最后，乱放会出诡异 bug。
// 协作方：middlewares/（各中间件实现）、routes/（业务路由）、index.ts（调用 createApp）
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { requestLogger } from './middlewares/requestLogger';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { auditRouter } from './routes/audit';
import { authRouter } from './routes/auth';
import { chatRouter } from './routes/chat';
import { documentsRouter } from './routes/documents';
import { healthRouter } from './routes/health';
import { uploadRouter } from './routes/upload';
import { usageRouter } from './routes/usage';

// 前端打包产物目录（React 构建出的一堆静态文件）。生产模式下页面由本服务
// 直接对外提供，浏览器只需访问后端这一个端口；可用环境变量 WEB_DIST 覆盖
const WEB_DIST =
  process.env.WEB_DIST ?? path.resolve(__dirname, '..', '..', 'web', 'dist');

export function createApp() {
  const app = express();

  // 解析 JSON 请求体：把 body 里的 JSON 字符串自动变成 req.body 对象，
  // 路由代码里才能直接写 req.body.username。limit 1MB 防恶意大请求体撑爆内存
  app.use(express.json({ limit: '1mb' }));
  // 访问日志放所有中间件最前面：它之后发生的每个请求（包括出错的）都能记到
  app.use(requestLogger);

  // 业务路由统一挂 /api 前缀（如 /api/auth/login），与下面的静态页面分开互不干扰
  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', documentsRouter);
  app.use('/api', auditRouter);
  app.use('/api', uploadRouter);
  app.use('/api', usageRouter);
  app.use('/api', chatRouter);

  // 生产模式专属的两步：静态托管 + SPA 回退（本地开发时前端由 vite 独立起服务，
  // dist 目录不存在，这里整块跳过）
  if (fs.existsSync(WEB_DIST)) {
    // 静态托管：按同名 URL 直接返回文件（/assets/index.js → dist/assets/index.js）
    app.use(
      express.static(WEB_DIST, {
        // assets 里的文件名带内容 hash：内容一变名字就变，可以放心永久缓存
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            // 缓存一个月 + immutable：浏览器连"问有没有更新"都不用做
            res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
          }
        },
      }),
    );
    // SPA 回退：前端是单页应用，/login 这类地址在服务器上并没有真实文件，刷新会 404。
    // 这里把"不以 /api 开头"的所有 GET 都改发 index.html，交给前端路由接管。
    // 正则特意排除 /api——否则打错的 API 请求会被吞成一张 HTML 页，前端更难排查
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
      // index.html 不缓存：发新版后用户刷新立刻拿到新页面
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  }

  // 兜底两件套必须放最后：没被任何路由接住的请求走 notFoundHandler（404），
  // 路由抛出的错误走 errorHandler（统一错误 JSON）。Express 认"四参数函数 =
  // 错误中间件"，且只有排在所有路由之后才接得住错误
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
