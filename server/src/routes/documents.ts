// ===== 文档管理路由：知识库文档的列表与删除 =====
// 列表人人可看（登录即可），删除是危险操作仅 admin 可执行。
// 删文档记录时，其全部分块与向量数据由数据库级联自动清掉（见下），
// 审计日志照例留痕。查询简单，SQL 就直写在这里、不再抽 service 层
import { Router } from 'express';
import { pool } from '../db';
import { requireAuth, requireRole } from '../middlewares/auth';
import { clientIp, recordAudit } from '../services/audit';
import { asyncHandler } from '../utils/asyncHandler';
import { HttpError, ok } from '../utils/response';

export const documentsRouter = Router();

// 数据库行的原样形状（蛇形命名）。下面映射成前端习惯的驼峰命名，
// 隔这一层，前端就不必迁就数据库的命名风格
interface DocumentRow {
  id: number;
  filename: string;
  file_type: string;
  file_size: number;
  chunk_count: number;
  created_at: string;
}

// 文档列表（按上传时间倒序）。requireAuth：需要登录，但普通用户也能看
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

// 删除文档：两个中间件叠着用——先 requireAuth 验登录，再 requireRole('admin')
// 验角色，普通用户会被挡在 403（危险操作只放管理员）
documentsRouter.delete(
  '/documents/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, '无效的文档 ID');
    }
    // 先查再删而不是一条 DELETE 完事：既能在"不存在"时给出精确的 404，
    // 又能先拿到文件名——后面记审计、返回响应都要用它
    const found = await pool.query<{ filename: string }>(
      'SELECT filename FROM documents WHERE id = $1',
      [id],
    );
    if (found.rows.length === 0) {
      throw new HttpError(404, '文档不存在');
    }
    const filename = found.rows[0].filename;
    // 只删 documents 这一行即可：schema 里 chunks 表对 document_id 设了
    // ON DELETE CASCADE，该文档全部分块（含 pgvector 向量数据）由数据库连带删除，
    // 不会留下"搜得到却打不开"的孤儿向量
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
