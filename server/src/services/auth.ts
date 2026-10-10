import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { config } from '../config';

export interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, config.jwt.secret) as {
      id: number;
      username: string;
      role: string;
    };
    if (payload.role !== 'admin' && payload.role !== 'user') return null;
    return { id: payload.id, username: payload.username, role: payload.role };
  } catch {
    return null;
  }
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    'SELECT id, username, password_hash, role FROM users WHERE username = $1',
    [username],
  );
  return rows[0] ?? null;
}

export async function createUser(username: string, password: string, role: string): Promise<UserRow> {
  const { rows } = await pool.query<UserRow>(
    'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, password_hash, role',
    [username, hashPassword(password), role],
  );
  return rows[0];
}

const SEED_USERS = [
  { username: 'admin', password: 'admin123', role: 'admin' },
  { username: 'demo', password: 'demo123', role: 'user' },
];

export async function ensureSeedUsers(): Promise<void> {
  const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM users');
  if (Number(rows[0].count) > 0) return;
  for (const seed of SEED_USERS) {
    await createUser(seed.username, seed.password, seed.role);
    console.log(`已创建初始账号: ${seed.username} / ${seed.password}（角色 ${seed.role}）`);
  }
}
