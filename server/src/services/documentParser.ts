import fs from 'node:fs/promises';
import pdfParse from 'pdf-parse';
import { HttpError } from '../utils/response';

const TEXT_EXTS = ['.md', '.markdown', '.txt'];

export async function parseDocumentToText(
  filePath: string,
  ext: string,
): Promise<string> {
  if (ext === '.pdf') {
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (TEXT_EXTS.includes(ext)) {
    return fs.readFile(filePath, 'utf8');
  }
  throw new HttpError(400, `不支持的文件类型: ${ext}`);
}
