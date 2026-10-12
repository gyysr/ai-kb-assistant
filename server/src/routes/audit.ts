// ===== 审计日志查询路由（仅管理员）=====
// 各关键动作（登录成败/上传/删除……）由 services/audit.ts 自动写入 audit_logs 表，
// 这里只提供只读查询，是管理端"监控面板"的数据源，requireRole 挡住普通用户
import { Router } from 'express';
import { pool } from '../db';
import { requireAuth, requireRole } from '../middlewares/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';

export const auditRouter = Router();

// 一条审计记录的形状：谁（user_id/username）从哪个 IP 在何时做了什么（action），
// detail 是附加详情（如删了哪个文件）——蛇形命名，下面统一转驼峰
interface AuditRow {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

// 最近 200 条审计记录（按时间倒序）。LIMIT 200 是刻意为之：
// 日志表只增不减会越积越大，全量返回会把接口和浏览器一起拖垮
auditRouter.get(
  '/audit',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query<AuditRow>(
      `SELECT id, user_id, username, action, detail, ip, created_at
       FROM audit_logs ORDER BY created_at DESC LIMIT 200`,
    );
    res.json(
      ok(
        rows.map((r) => ({
          id: r.id,
          userId: r.user_id,
          username: r.username,
          action: r.action,
          detail: r.detail,
          ip: r.ip,
          createdAt: r.created_at,
        })),
      ),
    );
  }),
);
