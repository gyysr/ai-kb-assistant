import { config } from '../config';
import { HttpError } from '../utils/response';

interface EmbeddingResponse {
  data: { index: number; embedding: number[] }[];
}

const BATCH_SIZE = 10;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  const { apiKey, baseUrl, embeddingModel } = config.qwen;
  if (!apiKey) {
    throw new HttpError(500, '未配置 QWEN_API_KEY');
  }

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: embeddingModel, input: batch }),
        signal: AbortSignal.timeout(config.timeout.embeddingMs),
      });
    } catch (err) {
      if ((err as Error).name === 'TimeoutError') {
        throw new HttpError(504, '向量化服务响应超时，请稍后重试');
      }
      throw new HttpError(502, `向量化请求失败: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new HttpError(
        502,
        `向量化失败: ${res.status} ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as EmbeddingResponse;
    results.push(
      ...json.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding),
    );
  }
  return results;
}
