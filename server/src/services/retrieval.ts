import { config } from '../config';
import { pool } from '../db';
import { toVectorLiteral } from '../db/vector';
import { embedTexts } from './embedding';

export interface RetrievedChunk {
  id: number;
  document_id: number;
  chunk_index: number;
  content: string;
  filename: string;
  score: number;
}

export async function searchKnowledge(
  question: string,
  topK = config.rag.topK,
): Promise<RetrievedChunk[]> {
  const [embedding] = await embedTexts([question]);
  const { rows } = await pool.query<RetrievedChunk>(
    `SELECT c.id::int AS id,
            c.document_id::int AS document_id,
            c.chunk_index,
            c.content,
            d.filename,
            1 - (c.embedding <=> $1::vector) AS score
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     ORDER BY c.embedding <=> $1::vector
     LIMIT $2`,
    [toVectorLiteral(embedding), topK],
  );
  return rows;
}
