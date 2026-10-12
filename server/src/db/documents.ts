// ===== 文档与块的写库操作：documents / chunks 两张表的 SQL 都收在这 =====
// 是入库流水线（services/ingestion.ts）的最后一站，也被管理端路由调用；
// 所有查询都走 db/index.ts 的连接池。
import { pool } from './index';
import { toVectorLiteral } from './vector';

// 一条待写入的文档元信息
export interface NewDocument {
  filename: string;
  fileType: string;
  fileSize: number;
}

// 建文档记录并返回新 id：RETURNING 让"插入"和"取主键"一次数据库往返完成
export async function insertDocument(doc: NewDocument): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    'INSERT INTO documents (filename, file_type, file_size) VALUES ($1, $2, $3) RETURNING id',
    [doc.filename, doc.fileType, doc.fileSize],
  );
  return rows[0].id;
}

// PG 的 COUNT(*) 也按字符串返回（BIGINT 同款坑），Number() 转回数字
export async function countDocuments(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM documents',
  );
  return Number(rows[0].count);
}

// 一个待入库的块：它在文档内的序号、原文内容、对应的 1024 维向量
export interface NewChunk {
  index: number;
  content: string;
  embedding: number[];
}

// 事务写入所有块并更新文档块数：要么全部成功，要么一条不留。
// 事务的 BEGIN/COMMIT 必须落在同一个连接上，而 pool.query 每次可能借到
// 不同连接——所以这里手动从池里借一个 client 独占到底
export async function insertChunks(
  documentId: number,
  chunks: NewChunk[],
): Promise<void> {
  const client = await pool.connect();
  try {
    // BEGIN 之后的所有 SQL 都处于"未生效"状态，COMMIT 时才一起落库
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
    // 出错：整批撤销，避免留下"文档存在但只有一半块"的脏数据
    await client.query('ROLLBACK');
    throw err;
  } finally {
    // 把连接还回池子（finally 保证出错也还）：不还的话池会被慢慢耗干，之后所有请求卡死
    client.release();
  }
}
