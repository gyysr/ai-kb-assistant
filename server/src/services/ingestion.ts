import path from 'node:path';
import { insertChunks, insertDocument } from '../db/documents';
import { HttpError } from '../utils/response';
import { chunkText } from './chunker';
import { embedTexts } from './embedding';
import { parseDocumentToText } from './documentParser';

export interface IngestFile {
  storedPath: string;
  originalName: string;
  size: number;
}

export async function ingestDocument(file: IngestFile) {
  const ext = path.extname(file.originalName).toLowerCase();
  const text = await parseDocumentToText(file.storedPath, ext);
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new HttpError(400, '文档解析结果为空，无法入库');
  }

  const embeddings = await embedTexts(chunks);

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
