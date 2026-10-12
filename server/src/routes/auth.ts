// ===== 登录/注册/登出路由：认证体系的入口 =====
// 浏览器敲账号密码后请求的就是这里。校验通过发 JWT token（后续每个请求
// 带着它证明"我是登录过的用户"，前端存进 localStorage），失败返回统一错误格式。
// 密码校验、token 签发等实现在 services/auth.ts，这里只做参数校验和流程编排
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

// 登录/注册共用的请求体形状。字段都标成可选：用户可能压根没传，
// 所以下面的路由代码必须逐个判空后才敢用
interface CredentialsBody {
  username?: string;
  password?: string;
}

// 对外只暴露这三个字段：数据库行里的密码哈希等敏感信息绝不外传
function publicUser(user: AuthUser) {
  return { id: user.id, username: user.username, role: user.role };
}

// 注册：公开接口（此时还没 token 可带），但字段规矩先立好——
// 用户名 3-32 位、密码至少 6 位，不合规当场 400 打回
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
    // 先查重再插入（users 表另有唯一约束兜底，并发注册也插不出重名）
    const existing = await findUserByUsername(name);
    if (existing) {
      throw new HttpError(409, '用户名已被占用');
    }
    // 新注册用户一律普通 user 角色：admin 只能由种子数据/运维手动授予，
    // 自助注册永远提不了权。createUser 内部会把密码哈希后才落库
    const created = await createUser(name, password, 'user');
    const user: AuthUser = { id: created.id, username: created.username, role: 'user' };
    await recordAudit({
      userId: user.id,
      username: user.username,
      action: 'register',
      ip: clientIp(req),
    });
    // 注册成功直接发 token，前端存 localStorage，省得用户注册完还要再登录一次
    res.json(ok({ token: signToken(user), user: publicUser(user) }));
  }),
);

// 登录：查用户 → 验密码 → 发 token，无论成败都记一条审计日志
authRouter.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body as CredentialsBody;
    const ip = clientIp(req);
    const row =
      typeof username === 'string' ? await findUserByUsername(username.trim()) : null;
    // 用户不存在或密码不对，统一报同一句话——不区分到底是哪个错，
    // 免得帮撞库的人确认"这个用户名是存在的"。
    // verifyPassword 比对的是哈希：库里只存加密后的密文，明文密码永不落库
    if (!row || typeof password !== 'string' || !verifyPassword(password, row.password_hash)) {
      // 失败也记审计：短时间内连串 login_fail 就是有人在试密码的信号
      await recordAudit({
        userId: row?.id,
        username: typeof username === 'string' ? username.trim() : undefined,
        action: 'login_fail',
        ip,
      });
      throw new HttpError(401, '用户名或密码错误');
    }
    // 防御性检查：万一库里 role 字段被写进脏值（既非 admin 也非 user），
    // 也按登录失败处理，不让未知角色的账号混进来
    if (row.role !== 'admin' && row.role !== 'user') {
      throw new HttpError(401, '用户名或密码错误');
    }
    const user: AuthUser = { id: row.id, username: row.username, role: row.role };
    await recordAudit({ userId: user.id, username: user.username, action: 'login', ip });
    // 签发 JWT：token 内含用户 id/角色并盖了密钥签名，之后每个请求带上它
    // 即可自证身份（middlewares/auth.ts 负责验签），服务端无需再查库
    res.json(ok({ token: signToken(user), user: publicUser(user) }));
  }),
);

// 查当前登录者是谁。requireAuth 是中间件（middlewares/auth.ts）：先验 token，
// 通过后把用户信息挂到 req.user 再放行；写在路由参数里就等于声明"要登录才能访问"。
// 前端刷新页面时靠它恢复登录态
authRouter.get(
  '/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(ok({ user: publicUser(req.user!) }));
  }),
);

// 登出：JWT 一旦发出就收不回（服务端不存登录状态），这个接口没法作废 token，
// 只补一条审计日志；真正擦除登录态的动作在前端清 localStorage 完成
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
