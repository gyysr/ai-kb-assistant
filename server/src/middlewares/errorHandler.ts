// ===== 统一错误处理 + 404 兜底：所有路由的最后一道出口 =====
// 各处 next(err) 抛来的错误最终都汇到这里集中处理，业务代码不必各写一套 try/catch。
// 在 app.ts 里挂在所有路由之后——Express 按注册顺序匹配，前面没接住的才轮到它。
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { logger } from '../services/logger';
import { HttpError } from '../utils/response';

// 全部路由都没匹配上时到这里：返回 404 + 统一响应格式
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    code: 404,
    data: null,
    message: `接口不存在: ${req.method} ${req.path}`,
  });
}

// Express 的识别规则：参数恰好 4 个（err, req, res, next）才会被当成"错误处理中间件"、
// 接到 next(err) 抛来的错误；少写一个参数它就只是普通中间件，永远收不到错误
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  // 默认按 500（服务器内部错误）处理，下面按错误类型逐层细化
  let status = 500;
  let code: number | undefined;
  let message = '服务器内部错误';

  // 业务代码抛的 HttpError 自带状态码与文案，原样透传给前端
  if (err instanceof HttpError) {
    status = err.status;
    code = err.code;
    message = err.message;
  // 上传库 multer 的专属错误：文件超限转 413（Payload Too Large），其余按 400
  } else if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      message = '文件超过大小限制';
    } else {
      status = 400;
      message = `上传失败: ${err.message}`;
    }
  } else if (err instanceof Error) {
    message = err.message;
  }

  // 只把 5xx 记入错误日志：4xx 是客户端自己的问题（参数错/没权限），服务器没事，不值得刷屏
  if (status >= 500) {
    logger.error({ err: err instanceof Error ? { message: err.message, stack: err.stack } : err, method: req.method, path: req.path }, 'unhandled_error');
  }

  // 统一响应格式 { code, data, message }：前端只需要处理一种形状
  res.status(status).json({ code: code ?? status, data: null, message });
}
