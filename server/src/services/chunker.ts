// ===== 分块器：把长文本切成不超过 800 字的块，相邻块重叠 100 字 =====
// 为什么切块：嵌入和检索都按"块"进行——块太大检索粒度粗，块太小上下文不完整。
// 为什么重叠：一句话恰好落在切口上会被切成两半，两半各自都不完整；重叠让边界
// 附近的内容在相邻两个块里都完整出现一次，检索时两边都能命中。
// 被 ingestion.ts 调用，切出的块交给 embedding.ts 向量化；800/100 来自 config。
import { config } from '../config';

const { maxChars, overlapChars } = config.chunk;

// 兜底的"硬切"：不认语义，按固定步长（800-100=700 字）机械切片。
// 当前主流程走的是 chunkText 自己的切法，这个函数留作最底层保底参考
function hardSplit(text: string): string[] {
  const step = maxChars - overlapChars;
  const parts: string[] = [];
  for (let start = 0; start < text.length; start += step) {
    parts.push(text.slice(start, start + maxChars));
  }
  return parts;
}

// 处理单个超长"段落"（一行超过 800 字）：先按句子边界切，句子本身超长再硬切
function splitLongParagraph(para: string): string[] {
  // 按中英文句末标点（。！？；. 等）把段落切成一个个句子；匹配不到就整段当一个句子
  const sentences = para.match(/[^。！？!?；;.\n]+[。！？!?；;.]?/g) ?? [para];
  const parts: string[] = [];
  let buf = '';
  // 贪心装箱：句子往缓冲区里塞，塞满 800 字就封箱、开新的
  for (const sentence of sentences) {
    if (buf.length + sentence.length > maxChars && buf) {
      parts.push(buf);
      buf = sentence;
    } else {
      buf += sentence;
    }
    // 单个句子本身就超过 800 字（比如一长串没有标点的文字）：只能硬切，同样保留重叠
    while (buf.length > maxChars) {
      parts.push(buf.slice(0, maxChars));
      buf = buf.slice(maxChars - overlapChars);
    }
  }
  if (buf.trim()) {
    parts.push(buf);
  }
  return parts;
}

// 主入口，三步走：①拆行（超长行按句子拆）②把行贪心拼满 800 字成块 ③补重叠
export function chunkText(text: string): string[] {
  // 统一换行符（Windows 的 \r\n 换成 \n）并去掉首尾空白
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) {
    return [];
  }

  // 第一步：按空行/换行拆成"行"单元。短行直接收，超长行交给 splitLongParagraph
  const units: string[] = [];
  for (const line of cleaned
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (line.length <= maxChars) {
      units.push(line);
    } else {
      units.push(...splitLongParagraph(line));
    }
  }

  // 第二步：行单元贪心拼箱——尽量拼满 800 字再封块，行与行之间用 \n 连接
  const packed: string[] = [];
  let current = '';
  for (const unit of units) {
    if (current && current.length + unit.length + 1 > maxChars) {
      packed.push(current);
      current = unit;
    } else {
      current = current ? `${current}\n${unit}` : unit;
    }
  }
  if (current) {
    packed.push(current);
  }

  // 第三步：从第 2 块起，把上一块结尾 100 字拼到自己开头——"重叠"就落地在这一行
  return packed.map((chunk, i) =>
    i === 0 ? chunk : packed[i - 1].slice(-overlapChars) + chunk,
  );
}
