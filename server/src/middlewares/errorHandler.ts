import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { logger } from '../services/logger';
import { HttpError } from '../utils/response';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    code: 404,
    data: null,
    message: `接口不存在: ${req.method} ${req.path}`,
  });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  let status = 500;
  let code: number | undefined;
  let message = '服务器内部错误';

  if (err instanceof HttpError) {
    status = err.status;
    code = err.code;
    message = err.message;
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

  if (status >= 500) {
    logger.error({ err: err instanceof Error ? { message: err.message, stack: err.stack } : err, method: req.method, path: req.path }, 'unhandled_error');
  }

  res.status(status).json({ code: code ?? status, data: null, message });
}
