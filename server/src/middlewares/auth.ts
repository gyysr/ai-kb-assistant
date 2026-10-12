// ===== 登录关卡：requireAuth（验登录）与 requireRole（验角色）两个中间件 =====
// "中间件" = Express 的关卡：请求进入路由前先路过它，调 next() 放行，
// 调 next(错误) 拦下并交给统一错误处理。路由挂上 requireAuth 就等于声明"此接口需登录"。
// token 的签发/校验在 services/auth.ts，这里只做"取 token → 验 → 挂到 req.user"。
import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '../services/auth';
import { verifyToken } from '../services/auth';
import { HttpError } from '../utils/response';

// 给 Express 的 Request 类型补一个 user 字段（TS 的全局类型扩展）：
// 之后所有路由都能类型安全地读 req.user，不必自己写 as 断言
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// 通用登录关卡：挂在任何需要登录的路由上
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  // 前端登录后每次请求都带 "Authorization: Bearer <token>"，这里按约定格式取出 token
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    next(new HttpError(401, '未登录，请先登录'));
    return;
  }
  const user = verifyToken(token);
  // 401 = token 过期或无效（伪造），统一按"登录已过期"提示重新登录
  if (!user) {
    next(new HttpError(401, '登录已过期，请重新登录'));
    return;
  }
  // 把验出来的身份挂到请求对象上：后面的路由、requireRole、日志中间件都能直接用
  req.user = user;
  next();
}

// 角色关卡（工厂函数）：requireRole('admin') 返回一个真正的中间件。
// 401 = 没登录；403 = 登录了但角色不够（"认出你了，但你没权限"）
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
