// ===== SSE 聊天接口：整个系统最核心、最复杂的一环 =====
// 用户提问从这进来，回答"一个字一个字"流回浏览器（打字机效果）。
// 走的是 SSE（Server-Sent Events）：一种服务器单向持续推送的 HTTP 长连接——
// 普通接口要等全部算完才能回，SSE 想到一个字就能发一个字。
// 回答的真正生产者是 services/agent.ts（RAG 检索 + 调通义千问 + 工具调用），
// 本文件的职责是把 agent 各阶段的进展翻译成一串 SSE 事件写回前端
import { Router } from 'express';
import { countDocuments } from '../db/documents';
import { requireAuth } from '../middlewares/auth';
import { logger } from '../services/logger';
import { runAgent } from '../services/agent';
import type { SourceItem } from '../services/tools';
import { asyncHandler } from '../utils/asyncHandler';
import { HttpError } from '../utils/response';

export const chatRouter = Router();

// 请求体只有一个字段 message（前端 streamChat 发送时的字段名就是它）
interface ChatBody {
  message?: string;
}

// 检索来源的"对外版"：只挑前端要展示的字段，内部实现细节不外泄
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
    // 此刻还是普通请求，可以像常规接口一样抛 400（asyncHandler 会转给错误
    // 中间件，返回 JSON 错误体）；一旦下面进入流式模式，状态码就锁死 200 改不了了
    if (typeof message !== 'string' || !message.trim()) {
      throw new HttpError(400, 'message 不能为空');
    }
    const question = message.trim();
    const startedAt = Date.now();
    // 记日志的基础信息：谁问的、问了什么（截到 100 字，防超长提问撑爆日志）
    const logBase = {
      user: req.user?.username,
      question: question.slice(0, 100),
    };

    // 这四个响应头把本响应声明成一条 SSE 流：
    // text/event-stream 告诉浏览器"这是事件流，来一段处理一段"；
    // no-cache / keep-alive 防中间层缓存或提前掐断这条长连接；
    // X-Accel-Buffering: no 是给 nginx 的暗号——别攒一批再转发，来一段转一段
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // 立刻把响应头发出去，连接从这一刻起变成"边产边发"
    res.flushHeaders();

    // 手写 SSE 报文（没用库）：一帧 = "event: 事件名\n" + "data: 裸JSON\n\n"，
    // 结尾两个换行（空行）表示一帧结束。前端 api.ts 的 handleBlock 按同样
    // 规则拆包，两边格式必须一字不差地对上
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // AbortController 是"紧急停止按钮"。客户端断开时按下去，abort.signal 会
    // 一路传给 runAgent → 模型请求，让上游尽快停工，不再白白产出没人收的内容
    const abort = new AbortController();
    // Node 21 下 req 的 close 在请求体消费完就会触发，只有响应提前关闭才算客户端断开
    //（补充：writableEnded=true 是我们自己 res.end() 的正常收尾，不算断开，别误停）
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    try {
      // 空库兜底：一条文档都没有时直接引导上传，不调用模型
      //（省一次模型调用费，也避免"什么都检索不到还硬让模型编"）
      if ((await countDocuments()) === 0) {
        send('delta', {
          content: '知识库里还没有已入库的文档，请先用管理员账号在「文档管理」页上传 PDF 或 Markdown 文件，再开始提问。',
        });
        send('done', { usage: null });
        logger.info({ ...logBase, latencyMs: Date.now() - startedAt, emptyKb: true }, 'chat_skipped_empty_kb');
        res.end();
        return;
      }

      // 正式回答交给 agent：它边跑边通过 callbacks 汇报进展，这里把每种进展
      // 映射成一种 SSE 事件——工具开始/结束（前端显示"正在检索知识库…"）、
      // sources（回答依据的来源列表）、delta（一个个文字片段，打字机效果的核心）。
      // 模型侧的流式空闲超时（CHAT_TIMEOUT_MS）也在 agent 内部处理：
      // 超时会中止并抛错，最后统一流进下面的 catch 转成 error 事件
      const result = await runAgent(question, {
        signal: abort.signal,
        callbacks: {
          onToolStart: (name, args) => send('tool', { name, args, status: 'running' }),
          onToolEnd: (name, args) => send('tool', { name, args, status: 'done' }),
          onSources: (sources) => send('sources', sources.map(toPublicSource)),
          onDelta: (content) => send('delta', { content }),
        },
      });
      // 客户端已断开（aborted）就不再发 done：写了也没人收，还可能挤出半帧
      if (!abort.signal.aborted) {
        send('done', { usage: result.usage });
      }
      // 每次完整对话记一条结构化日志：耗时、工具轮数、命中知识块/网页数、
      // token 用量——观察成本和效果全靠它
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
      // 流式接口出错时已改不了 HTTP 状态码（200 早已发出），只能降级成
      // error 事件让前端弹提示；客户端主动断开导致的错则什么都别发
      const msg = err instanceof Error ? err.message : '服务异常';
      if (!abort.signal.aborted) {
        send('error', { message: msg });
      }
      logger.warn({ ...logBase, latencyMs: Date.now() - startedAt, error: msg }, 'chat_failed');
    }
    // 无论成功失败都显式收尾：不 end 的话这条长连接会一直挂着占资源
    res.end();
  }),
);
