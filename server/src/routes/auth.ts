import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import {
  createUser,
  findUserByUsername,
  signToken,
  verifyPassword,
  type AuthUser,
} from '../services/auth';
import { clientIp, recordAudit } from '../services/audit';
import { asyncHandler } from '../utils/asyncHandler';
import { HttpError, ok } from '../utils/response';

export const authRouter = Router();

interface CredentialsBody {
  username?: string;
  password?: string;
}

function publicUser(user: AuthUser) {
  return { id: user.id, username: user.username, role: user.role };
}

authRouter.post(
  '/auth/register',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body as CredentialsBody;
    if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 32) {
      throw new HttpError(400, '用户名长度需在 3-32 个字符之间');
    }
    if (typeof password !== 'string' || password.length < 6) {
      throw new HttpError(400, '密码至少 6 位');
    }
    const name = username.trim();
    const existing = await findUserByUsername(name);
    if (existing) {
      throw new HttpError(409, '用户名已被占用');
    }
    const created = await createUser(name, password, 'user');
    const user: AuthUser = { id: created.id, username: created.username, role: 'user' };
    await recordAudit({
      userId: user.id,
      username: user.username,
      action: 'register',
      ip: clientIp(req),
    });
    res.json(ok({ token: signToken(user), user: publicUser(user) }));
  }),
);

authRouter.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body as CredentialsBody;
    const ip = clientIp(req);
    const row =
      typeof username === 'string' ? await findUserByUsername(username.trim()) : null;
    if (!row || typeof password !== 'string' || !verifyPassword(password, row.password_hash)) {
      await recordAudit({
        userId: row?.id,
        username: typeof username === 'string' ? username.trim() : undefined,
        action: 'login_fail',
        ip,
      });
      throw new HttpError(401, '用户名或密码错误');
    }
    if (row.role !== 'admin' && row.role !== 'user') {
      throw new HttpError(401, '用户名或密码错误');
    }
    const user: AuthUser = { id: row.id, username: row.username, role: row.role };
    await recordAudit({ userId: user.id, username: user.username, action: 'login', ip });
    res.json(ok({ token: signToken(user), user: publicUser(user) }));
  }),
);

authRouter.get(
  '/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(ok({ user: publicUser(req.user!) }));
  }),
);

authRouter.post(
  '/auth/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await recordAudit({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'logout',
      ip: clientIp(req),
    });
    res.json(ok({}));
  }),
);
