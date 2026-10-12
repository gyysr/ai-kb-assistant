// ===== 账号与令牌：密码哈希（scrypt）+ JWT 签发/校验 + users 表读写 =====
// 为什么存哈希不存明文：数据库一旦泄露，明文密码直接暴露（且用户常一码多用）；
// 哈希是单向的"指纹"，泄露了也反不回原文。校验时把输入密码重算一次哈希比对即可。
// scrypt 来自 Node 内置 crypto 模块——不装 bcrypt，就少一个要本地编译的原生依赖。
// 被 routes/auth.ts（登录/注册）和 middlewares/auth.ts（每个请求验 token）使用。
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { config } from '../config';

// 请求方身份三要素：验签成功后挂到 req.user 上，后续路由、日志中间件直接读取
export interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

// users 表一行的形状；password_hash 是"盐:哈希"拼接串（见下面 hashPassword）
interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
}

// 生成"盐:哈希"串存库
export function hashPassword(password: string): string {
  // "盐" = 每个密码专属的 16 字节随机数：同样的密码因盐不同产出不同哈希，
  // 攻击者没法拿预制好的"彩虹表"批量反查
  const salt = randomBytes(16).toString('hex');
  // 用"密码 + 盐"算出 64 字节哈希；同样的输入必然得到同样的输出——这就是能校验的原因
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// 校验密码：从存储串里拆出当时的盐，重算哈希后与存的哈希比对
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  // timingSafeEqual = 常数时间比较：防止攻击者靠"比较耗时"的微小差异逐字节猜哈希
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// 签发 JWT（JSON Web Token）= 一段带服务端签名的身份凭证：载荷（id/用户名/角色）
// + 用密钥生成的签名。客户端每次请求带上它，服务端用密钥验签即可确认身份，
// 不需要在服务端存任何 session 状态（12 小时过期，配置见 config.jwt）
export function signToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);
}

// 校验 token：签名不对或已过期时 jwt.verify 会抛异常，这里吞掉并返回 null——
// 调用方只需关心"有效（返回用户对象）或无效（返回 null）"
export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, config.jwt.secret) as {
      id: number;
      username: string;
      role: string;
    };
    // 角色白名单校验：防止令牌里被塞进意料之外的角色值
    if (payload.role !== 'admin' && payload.role !== 'user') return null;
    return { id: payload.id, username: payload.username, role: payload.role };
  } catch {
    return null;
  }
}

// 登录用：按用户名查一行；$1 占位符传参，杜绝 SQL 注入
export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    'SELECT id, username, password_hash, role FROM users WHERE username = $1',
    [username],
  );
  return rows[0] ?? null;
}

// 注册/建号用：RETURNING 让"插入"和"取回新行"一次数据库往返完成
export async function createUser(username: string, password: string, role: string): Promise<UserRow> {
  const { rows } = await pool.query<UserRow>(
    'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, password_hash, role',
    [username, hashPassword(password), role],
  );
  return rows[0];
}

// 种子账号：users 空表时自动创建的初始账号——否则系统刚装好时一个人都登录不进去
const SEED_USERS = [
  { username: 'admin', password: 'admin123', role: 'admin' },
  { username: 'demo', password: 'demo123', role: 'user' },
];

// 服务启动时调用（见 index.ts）：只在空表时种账号，重启不会重复创建或覆盖已有用户
export async function ensureSeedUsers(): Promise<void> {
  const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM users');
  if (Number(rows[0].count) > 0) return;
  for (const seed of SEED_USERS) {
    await createUser(seed.username, seed.password, seed.role);
    console.log(`已创建初始账号: ${seed.username} / ${seed.password}（角色 ${seed.role}）`);
  }
}
