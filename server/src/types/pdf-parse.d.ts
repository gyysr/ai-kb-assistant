// ===== pdf-parse 的 TS 类型声明 =====
// .d.ts 结尾的文件是"纯类型文件"：只描述形状，编译后不产出任何 JS 代码。
// pdf-parse 是个社区老库，发布时没带 TS 类型；TS 项目里 import 一个编译器
// 不认识的包会直接报错，所以用 declare module 手写一份"说明书"，告诉编译器
// 这个包导出的是什么形状。使用方是 services/documentParser.ts
declare module 'pdf-parse' {
  // 解析结果的实际形状（照着库文档写）：全文文本、页数、元信息等。本项目只用 text
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }
  // 吃文件的字节（Buffer/Uint8Array），吐出解析结果
  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;
  // CommonJS 风格导出（等价于 module.exports = pdfParse），
  // 对应 esModuleInterop 下的默认导入写法
  export = pdfParse;
}
