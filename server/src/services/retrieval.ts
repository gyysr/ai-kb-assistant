// ===== 知识库检索：按语义相似度找出与问题最相关的 Top-K 个块 =====
// "余弦相似度"：比较两个向量"方向"的夹角，夹角越小越相似，跟向量长度无关——
// 所以一段长文档和一个短问题也能公平比较。pgvector 的 <=> 运算符算的就是
// 余弦距离。被 tools.ts 的 search_knowledge 工具调用，是 RAG 问答里
// "先找上下文"的一步：找到的块随后作为上下文喂给大模型生成回答。
import { config } from '../config';
import { pool } from '../db';
import { toVectorLiteral } from '../db/vector';
import { embedTexts } from './embedding';

// 一条检索结果：块内容 + 它来自哪个文档 + 相似度得分（score 越大越相关）
export interface RetrievedChunk {
  id: number;
  document_id: number;
  chunk_index: number;
  content: string;
  filename: string;
  score: number;
}

// 检索主流程：问题向量化 → 按余弦相似度排序 → 取前 K 个
export async function searchKnowledge(
  question: string,
  topK = config.rag.topK,
): Promise<RetrievedChunk[]> {
  // 把问题也变成向量，才能和库里块的向量"比方向"；解构取出唯一的结果
  const [embedding] = await embedTexts([question]);
  // SQL 要点：
  //   <=> 是 pgvector 的余弦"距离"（0 = 方向一致，2 = 相反），ORDER BY 按距离
  //   升序 = 最相似的排最前；1 - 距离 转成"相似度"分数（越大越像）返回给调用方
  //   ::int 把 BIGINT 转回数字（pg 驱动对 64 位整数只返回字符串）
  //   LIMIT $2 即 Top-K：只留最相似的前 K 个（默认 5，可用环境变量 RAG_TOP_K 调）
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
