import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config';
import { requireAuth, requireRole } from '../middlewares/auth';
import { ingestDocument } from '../services/ingestion';
import { clientIp, recordAudit } from '../services/audit';
import { asyncHandler } from '../utils/asyncHandler';
import { HttpError, ok } from '../utils/response';

const ALLOWED_EXT = ['.pdf', '.md', '.markdown', '.txt'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(config.uploadDir, { recursive: true });
    cb(null, config.uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      cb(
        new HttpError(
          400,
          `不支持的文件类型 ${ext}，仅支持 ${ALLOWED_EXT.join(' / ')}`,
        ),
      );
      return;
    }
    cb(null, true);
  },
});

export const uploadRouter = Router();

uploadRouter.post(
  '/upload',
  requireAuth,
  requireRole('admin'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new HttpError(400, '缺少文件字段 file');
    }
    // multer 对中文文件名的 latin1 编码问题，转回 utf8
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString(
      'utf8',
    );
    const { documentId, chunkCount } = await ingestDocument({
      storedPath: req.file.path,
      originalName,
      size: req.file.size,
    });
    await recordAudit({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'document_upload',
      detail: { documentId, filename: originalName, chunkCount },
      ip: clientIp(req),
    });
    res.json(
      ok({
        documentId,
        filename: originalName,
        chunkCount,
      }),
    );
  }),
);
