import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '../services/auth';
import { verifyToken } from '../services/auth';
import { HttpError } from '../utils/response';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    next(new HttpError(401, '未登录，请先登录'));
    return;
  }
  const user = verifyToken(token);
  if (!user) {
    next(new HttpError(401, '登录已过期，请重新登录'));
    return;
  }
  req.user = user;
  next();
}

export function requireRole(role: 'admin' | 'user') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new HttpError(401, '未登录，请先登录'));
      return;
    }
    if (req.user.role !== role) {
      next(new HttpError(403, '没有权限执行该操作'));
      return;
    }
    next();
  };
}
