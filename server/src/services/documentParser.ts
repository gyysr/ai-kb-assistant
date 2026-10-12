// ===== 文档解析：RAG 流水线第一站，把上传的 pdf/md/txt 统一"榨"成纯文本 =====
// 产出的纯文本交给 chunker.ts 切块。pdf 是二进制格式，要用 pdf-parse 库
// 抽取其中的文字层；md/txt 本身就是纯文本，直接读文件即可。
import fs from 'node:fs/promises';
import pdfParse from 'pdf-parse';
import { HttpError } from '../utils/response';

// 纯文本类后缀：文件内容本身就是文字，读出来就能用，无需解析
const TEXT_EXTS = ['.md', '.markdown', '.txt'];

// 按后缀分流：pdf 走解析库，纯文本直接读，其余类型拒绝
export async function parseDocumentToText(
  filePath: string,
  ext: string,
): Promise<string> {
  if (ext === '.pdf') {
    // pdf 内部是压缩过的二进制结构，先整体读成 Buffer 再交给 pdf-parse 抽文字。
    // 注意：图片型扫描件没有文字层，会抽出空文本（由调用方 ingestion.ts 拦截）
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (TEXT_EXTS.includes(ext)) {
    return fs.readFile(filePath, 'utf8');
  }
  // 400 = 客户端的错（传了不支持的类型），不是服务器故障
  throw new HttpError(400, `不支持的文件类型: ${ext}`);
}
