import { pool } from '../db';

export interface AuditEntry {
  userId?: number;
  username?: string;
  action: string;
  detail?: Record<string, unknown>;
  ip?: string;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  await pool.query(
    'INSERT INTO audit_logs (user_id, username, action, detail, ip) VALUES ($1, $2, $3, $4, $5)',
    [entry.userId ?? null, entry.username ?? null, entry.action, entry.detail ?? null, entry.ip ?? null],
  );
}

export function clientIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip ?? req.socket?.remoteAddress ?? '';
}
