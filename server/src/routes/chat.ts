import { Router } from 'express';
import { countDocuments } from '../db/documents';
import { requireAuth } from '../middlewares/auth';
import { logger } from '../services/logger';
import { runAgent } from '../services/agent';
import type { SourceItem } from '../services/tools';
import { asyncHandler } from '../utils/asyncHandler';
import { HttpError } from '../utils/response';

export const chatRouter = Router();

interface ChatBody {
  message?: string;
}

function toPublicSource(s: SourceItem) {
  return {
    index: s.index,
    kind: s.kind,
    documentId: s.documentId,
    filename: s.filename,
    chunkIndex: s.chunkIndex,
    url: s.url,
    score: s.score,
    snippet: s.snippet,
  };
}

chatRouter.post(
  '/chat',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { message } = req.body as ChatBody;
    if (typeof message !== 'string' || !message.trim()) {
      throw new HttpError(400, 'message 不能为空');
    }
    const question = message.trim();
    const startedAt = Date.now();
    const logBase = {
      user: req.user?.username,
      question: question.slice(0, 100),
    };

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const abort = new AbortController();
    // Node 21 下 req 的 close 在请求体消费完就会触发，只有响应提前关闭才算客户端断开
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    try {
      // 空库兜底：一条文档都没有时直接引导上传，不调用模型
      if ((await countDocuments()) === 0) {
        send('delta', {
          content: '知识库里还没有已入库的文档，请先用管理员账号在「文档管理」页上传 PDF 或 Markdown 文件，再开始提问。',
        });
        send('done', { usage: null });
        logger.info({ ...logBase, latencyMs: Date.now() - startedAt, emptyKb: true }, 'chat_skipped_empty_kb');
        res.end();
        return;
      }

      const result = await runAgent(question, {
        signal: abort.signal,
        callbacks: {
          onToolStart: (name, args) => send('tool', { name, args, status: 'running' }),
          onToolEnd: (name, args) => send('tool', { name, args, status: 'done' }),
          onSources: (sources) => send('sources', sources.map(toPublicSource)),
          onDelta: (content) => send('delta', { content }),
        },
      });
      if (!abort.signal.aborted) {
        send('done', { usage: result.usage });
      }
      logger.info(
        {
          ...logBase,
          latencyMs: Date.now() - startedAt,
          rounds: result.rounds,
          kbHits: result.sources.filter((s) => s.kind === 'kb').length,
          webHits: result.sources.filter((s) => s.kind === 'web').length,
          promptTokens: result.usage?.promptTokens ?? null,
          completionTokens: result.usage?.completionTokens ?? null,
          totalTokens: result.usage?.totalTokens ?? null,
        },
        'chat_completed',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : '服务异常';
      if (!abort.signal.aborted) {
        send('error', { message: msg });
      }
      logger.warn({ ...logBase, latencyMs: Date.now() - startedAt, error: msg }, 'chat_failed');
    }
    res.end();
  }),
);
