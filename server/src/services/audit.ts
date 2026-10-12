// ===== 审计日志：把"谁在什么时候、从哪个 IP、做了什么"落到 audit_logs 表 =====
// 与 logger.ts 的运行日志分工：那份给开发者排查故障；这份记录登录、上传、删除等
// 用户敏感行为，供管理员事后追责。routes/ 里各敏感操作处调用 recordAudit。
import { pool } from '../db';

// 一条审计记录；用户字段可选——有些动作发生在登录之前（如"登录失败"），当时还不知道是谁
export interface AuditEntry {
  userId?: number;
  username?: string;
  action: string;
  detail?: Record<string, unknown>;
  ip?: string;
}

// 落库一条审计记录；?? null 把 undefined 归一成 NULL（pg 驱动不认识 undefined）
export async function recordAudit(entry: AuditEntry): Promise<void> {
  await pool.query(
    'INSERT INTO audit_logs (user_id, username, action, detail, ip) VALUES ($1, $2, $3, $4, $5)',
    [entry.userId ?? null, entry.username ?? null, entry.action, entry.detail ?? null, entry.ip ?? null],
  );
}

// 取客户端 IP：优先用 Express 解析好的 req.ip（可能来自代理头），取不到退到底层连接地址
export function clientIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip ?? req.socket?.remoteAddress ?? '';
}
