import { Router } from 'express';
import { pool } from '../db';
import { requireAuth, requireRole } from '../middlewares/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';

export const auditRouter = Router();

interface AuditRow {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

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
