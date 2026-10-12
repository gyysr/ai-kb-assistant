// ===== 建表 SQL：数据库全部表结构，启动时由 db/index.ts 的 initDb() 执行 =====
// 所有语句都带 IF NOT EXISTS：已建过就跳过，每次启动跑一遍也安全（简易版"迁移"）。
// 第一句 CREATE EXTENSION 先启用 pgvector 扩展——没有它，PG 不认识 vector 列类型
// 和相似度运算符 <=>。
//
// 表清单（与下面 SQL 的顺序一致）：
//   documents  文档元信息（文件名/类型/大小/块数）；正文切块另存 chunks 表
//   chunks     RAG 核心表：每个文本块一行，embedding 列 vector(1024) 的维度必须与
//              嵌入模型输出一致；document_id 外键带 ON DELETE CASCADE——删文档时
//              自动删光它名下的块，不留孤儿数据
//   users      账号表：password_hash 只存"盐:哈希"，绝不存明文（见 services/auth.ts）
//   audit_logs 审计日志：user_id 故意不设外键——用户被删后，日志也要原样保留供追责
//
// chunks 上还建了 HNSW 索引：百万级向量逐个暴力比相似度太慢，HNSW 用分层图结构
// 把检索提速到近似对数级（代价是结果略微近似）；vector_cosine_ops = 按余弦距离建，
// 与检索 SQL 里的 <=> 运算符对应。
//
// 坑：BIGSERIAL 主键经 pg 驱动查回来是字符串 "1" 而非数字 1（JS 的 number 装不下
// 64 位整数，驱动索性都按字符串处理），代码里要用 Number() 或 SQL 里 ::int 转换。
export const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id BIGSERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1024) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT,
  username VARCHAR(64),
  action VARCHAR(32) NOT NULL,
  detail JSONB,
  ip VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
