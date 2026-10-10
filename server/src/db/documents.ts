import { pool } from './index';
import { toVectorLiteral } from './vector';

export interface NewDocument {
  filename: string;
  fileType: string;
  fileSize: number;
}

export async function insertDocument(doc: NewDocument): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    'INSERT INTO documents (filename, file_type, file_size) VALUES ($1, $2, $3) RETURNING id',
    [doc.filename, doc.fileType, doc.fileSize],
  );
  return rows[0].id;
}

export async function countDocuments(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM documents',
  );
  return Number(rows[0].count);
}

export interface NewChunk {
  index: number;
  content: string;
  embedding: number[];
}

export async function insertChunks(
  documentId: number,
  chunks: NewChunk[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const chunk of chunks) {
      await client.query(
        'INSERT INTO chunks (document_id, chunk_index, content, embedding) VALUES ($1, $2, $3, $4)',
        [
          documentId,
          chunk.index,
          chunk.content,
          toVectorLiteral(chunk.embedding),
        ],
      );
    }
    await client.query('UPDATE documents SET chunk_count = $1 WHERE id = $2', [
      chunks.length,
      documentId,
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
