import { Router } from 'express';
import { pool } from '../db';
import { requireAuth, requireRole } from '../middlewares/auth';
import { clientIp, recordAudit } from '../services/audit';
import { asyncHandler } from '../utils/asyncHandler';
import { HttpError, ok } from '../utils/response';

export const documentsRouter = Router();

interface DocumentRow {
  id: number;
  filename: string;
  file_type: string;
  file_size: number;
  chunk_count: number;
  created_at: string;
}

documentsRouter.get(
  '/documents',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query<DocumentRow>(
      `SELECT id, filename, file_type, file_size, chunk_count, created_at
       FROM documents ORDER BY created_at DESC`,
    );
    res.json(
      ok(
        rows.map((r) => ({
          id: r.id,
          filename: r.filename,
          fileType: r.file_type,
          fileSize: r.file_size,
          chunkCount: r.chunk_count,
          createdAt: r.created_at,
        })),
      ),
    );
  }),
);

documentsRouter.delete(
  '/documents/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, '无效的文档 ID');
    }
    const found = await pool.query<{ filename: string }>(
      'SELECT filename FROM documents WHERE id = $1',
      [id],
    );
    if (found.rows.length === 0) {
      throw new HttpError(404, '文档不存在');
    }
    const filename = found.rows[0].filename;
    await pool.query('DELETE FROM documents WHERE id = $1', [id]);
    await recordAudit({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'document_delete',
      detail: { documentId: id, filename },
      ip: clientIp(req),
    });
    res.json(ok({ documentId: id, filename }));
  }),
);
