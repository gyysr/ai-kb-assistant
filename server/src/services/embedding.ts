// ===== 向量化服务：把文字变成 1024 维向量（"嵌入"，embedding）=====
// "向量" = 把一段文字浓缩成一串数字（本项目 1024 个数）：意思相近的文字得到的
// 数字串也相近，于是"找语义相似的内容"就变成了可计算的数学问题。
// RAG 流水线两头都靠它：入库时把每个块向量化（ingestion.ts），提问时把问题
// 向量化（retrieval.ts），两边才落在同一套"坐标"里可以比较。
// 模型用通义千问 text-embedding-v3，走 DashScope 的 OpenAI 兼容接口。
import { config } from '../config';
import { HttpError } from '../utils/response';

// 嵌入接口的返回结构：input 里的每段文本各对应一个 embedding 数字数组
interface EmbeddingResponse {
  data: { index: number; embedding: number[] }[];
}

// 一次请求最多带 10 段文本：接口对批量大小有上限，超了会被拒，必须分批
const BATCH_SIZE = 10;

// 批量向量化：内部按 BATCH_SIZE 分批调用接口，全部完成后按输入顺序返回向量数组
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
      // AbortSignal.timeout 是超时保护：EMBEDDING_TIMEOUT_MS（默认 15 秒）内没有
      // 响应就主动掐断请求，避免整条上传流水线被一次卡死拖到无限挂起
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
      // 504 = 上游超时；502 = 上游出错。带语义的状态码让前端能给用户准确的提示
      if ((err as Error).name === 'TimeoutError') {
        throw new HttpError(504, '向量化服务响应超时，请稍后重试');
      }
      throw new HttpError(502, `向量化请求失败: ${(err as Error).message}`);
    }
    if (!res.ok) {
      // 非 2xx：把响应体截前 200 字放进错误信息——够定位问题，又不至于刷屏
      const body = await res.text();
      throw new HttpError(
        502,
        `向量化失败: ${res.status} ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as EmbeddingResponse;
    // 接口不保证返回顺序与输入一致，按 index 排回输入顺序——
    // 否则第 N 块文本会配上别人的向量，检索结果全乱
    results.push(
      ...json.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding),
    );
  }
  return results;
}
