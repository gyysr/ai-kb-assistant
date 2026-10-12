// ===== 向量格式转换：JS 数字数组 → pgvector 的文本字面量 =====
// pgvector 的 vector 列不认 JS 数组，只认 '[0.1,0.2,...]' 这种字符串格式，所以
// 入库（db/documents.ts）和检索（services/retrieval.ts）前都要先过这一步。
// join(',') 直接拼出方括号字面量；数字转字符串即可，pgvector 不挑小数格式
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
