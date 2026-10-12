// ===== 入库编排：串起"解析 → 切块 → 向量化 → 写库"整条 RAG 流水线 =====
// 上传路由把文件存到磁盘后调用这里的 ingestDocument，它依次调用
// documentParser.ts（解析）、chunker.ts（切块）、embedding.ts（向量化），
// 最后经 db/documents.ts 写进数据库——是这个流水线唯一的"总指挥"。
import path from 'node:path';
import { insertChunks, insertDocument } from '../db/documents';
import { HttpError } from '../utils/response';
import { chunkText } from './chunker';
import { embedTexts } from './embedding';
import { parseDocumentToText } from './documentParser';

// 上传路由传进来的文件三要素：磁盘存储路径、原始文件名（用于判断后缀）、大小
export interface IngestFile {
  storedPath: string;
  originalName: string;
  size: number;
}

// 一条龙入口：任何一步抛错都会中断整条流水线，并原样反馈给上传接口
export async function ingestDocument(file: IngestFile) {
  const ext = path.extname(file.originalName).toLowerCase();
  const text = await parseDocumentToText(file.storedPath, ext);
  const chunks = chunkText(text);
  // 解析结果为空（如纯图片扫描版 PDF）就拒绝入库，免得产生一个永远检索不到的空文档
  if (chunks.length === 0) {
    throw new HttpError(400, '文档解析结果为空，无法入库');
  }

  const embeddings = await embedTexts(chunks);

  // 先建文档记录拿到 id，再把这个 id 写进每个块（chunks.document_id 外键关联）
  const documentId = await insertDocument({
    filename: file.originalName,
    fileType: ext,
    fileSize: file.size,
  });
  await insertChunks(
    documentId,
    chunks.map((content, index) => ({
      index,
      content,
      embedding: embeddings[index],
    })),
  );

  return { documentId, chunkCount: chunks.length };
}
