// ===== 文件上传路由：知识库的"进货口" =====
// 浏览器上传的文件先由 multer 中间件落盘，随后同步跑完
// "解析 → 分块 → 向量化 → 入库"整条流水线（services/ingestion.ts），
// 接口返回时新文档已经可被搜索。危险操作，仅 admin 可用
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

// 只收这四种格式——下游解析器（documentParser.ts）也只认它们
const ALLOWED_EXT = ['.pdf', '.md', '.markdown', '.txt'];

// multer 是 Express 生态处理文件上传的中间件。浏览器上传文件用
// multipart/form-data 编码：一个请求体里普通字段和文件混装在一起，multer
// 负责拆包——文件部分写进磁盘、字段部分挂到 req.body。这里用 diskStorage
// 定制"存到哪、叫什么名"
const storage = multer.diskStorage({
  // 目标目录不存在就现场建（recursive 连父目录一起补齐），首次上传也不报错
  destination: (_req, _file, cb) => {
    fs.mkdirSync(config.uploadDir, { recursive: true });
    cb(null, config.uploadDir);
  },
  // 落盘不用原始文件名：时间戳 + 随机串保证不重名，也躲开特殊字符/同名覆盖；
  // 扩展名保留，后面按扩展名挑解析器
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  // 单文件大小上限，来自 config（环境变量 MAX_FILE_SIZE_MB），这里换算成字节
  limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 },
  // 扩展名白名单：不认识的类型当场打回 400，不让它占磁盘
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

// 上传 + 入库。中间件按序生效：先验登录、再验 admin 角色、
// 最后 upload.single('file')——multer 的挂载点，只接一个名为 file 的文件字段
// （前端 FormData append 的名字必须一致），存好后文件信息挂到 req.file
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
    // 同步跑完整条入库流水线：解析出纯文本 → 切块 → 调模型向量化 → 写库。
    // 文档不大时秒级完成，所以直接等结果再响应，文档 ID 和分块数一并回给前端
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
