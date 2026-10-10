import { config } from '../config';

const { maxChars, overlapChars } = config.chunk;

function hardSplit(text: string): string[] {
  const step = maxChars - overlapChars;
  const parts: string[] = [];
  for (let start = 0; start < text.length; start += step) {
    parts.push(text.slice(start, start + maxChars));
  }
  return parts;
}

function splitLongParagraph(para: string): string[] {
  const sentences = para.match(/[^。！？!?；;.\n]+[。！？!?；;.]?/g) ?? [para];
  const parts: string[] = [];
  let buf = '';
  for (const sentence of sentences) {
    if (buf.length + sentence.length > maxChars && buf) {
      parts.push(buf);
      buf = sentence;
    } else {
      buf += sentence;
    }
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

export function chunkText(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) {
    return [];
  }

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

  return packed.map((chunk, i) =>
    i === 0 ? chunk : packed[i - 1].slice(-overlapChars) + chunk,
  );
}
