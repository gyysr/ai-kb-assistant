// ===== async 路由的错误"安全网" =====
// Express 只会自动捕获同步抛出的异常；路由函数若是 async，里面 throw 出的错
// 会变成无人接管的 rejected Promise（unhandledRejection），请求就此悬着——
// 浏览器一直转圈直到超时。本包装器给每个 async 路由兜底：错误一出现就
// .catch(next) 送进 Express 的错误中间件（middlewares/errorHandler.ts）统一处理。
// 协作方：routes/ 下所有带 async 的路由都靠它包装
import type { NextFunction, Request, RequestHandler, Response } from 'express';

// 用法：asyncHandler(async (req, res) => { ... })，返回的还是普通中间件，
// 对 Express 完全透明；参数原样透传给被包装的函数
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    // Express 约定 next(err) 会跳过后续普通中间件、直达错误中间件，
    // 于是 async 错误和同步错误汇入同一条处理通道
    fn(req, res, next).catch(next);
  };
}
