import { config } from '../config';
import { HttpError } from '../utils/response';

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallSpec {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCallSpec[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_calls'; calls: ToolCall[] };

interface ToolCallFragment {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface StreamChunk {
  choices?: {
    delta?: { content?: string; tool_calls?: ToolCallFragment[] };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
}

function buildRequestBody(
  messages: ChatMessage[],
  opts: { includeUsage: boolean; tools?: ToolSchema[] },
) {
  return {
    model: config.qwen.chatModel,
    messages,
    stream: true,
    ...(opts.includeUsage ? { stream_options: { include_usage: true } } : {}),
    ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools } : {}),
  };
}

async function requestStream(
  messages: ChatMessage[],
  opts: { includeUsage: boolean; tools?: ToolSchema[] },
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${config.qwen.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.qwen.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildRequestBody(messages, opts)),
    signal,
  });
}

export async function* streamChatCompletion(
  messages: ChatMessage[],
  opts: {
    signal?: AbortSignal;
    tools?: ToolSchema[];
    onUsage?: (usage: Usage) => void;
  } = {},
): AsyncGenerator<StreamEvent> {
  if (!config.qwen.apiKey) {
    throw new HttpError(500, '未配置 QWEN_API_KEY');
  }

  const idleMs = config.timeout.chatIdleMs;
  // 客户端断开（外层 signal）与模型空闲超时共用一个控制器；
  // 超时用带原因的 abort，便于和普通 AbortError 区分
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const armTimer = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new Error(`模型空闲超时（超过 ${idleMs}ms 无响应）`)),
      idleMs,
    );
  };
  const timedOut = () =>
    controller.signal.aborted &&
    controller.signal.reason instanceof Error &&
    controller.signal.reason.message.includes('模型空闲超时');

  let res: Response;
  try {
    armTimer();
    res = await requestStream(messages, { includeUsage: true, tools: opts.tools }, controller.signal);
    if (res.status === 400) {
      // 部分兼容层不支持 stream_options，降级去掉该参数重试
      armTimer();
      res = await requestStream(messages, { includeUsage: false, tools: opts.tools }, controller.signal);
    }
  } catch (err) {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
    if (timedOut()) {
      throw new HttpError(504, '模型服务响应超时，请稍后重试');
    }
    throw new HttpError(502, `模型请求失败: ${(err as Error).message}`);
  }
  if (!res.ok) {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
    const body = await res.text();
    throw new HttpError(502, `模型调用失败: ${res.status} ${body.slice(0, 200)}`);
  }
  if (!res.body) {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
    throw new HttpError(502, '模型未返回流式响应');
  }

  const fragments = new Map<number, ToolCall>();
  let sawToolFinish = false;

  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      armTimer();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;

        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(payload) as StreamChunk;
        } catch {
          continue;
        }

        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) {
          yield { type: 'text', content: delta.content };
        }
        if (delta?.tool_calls) {
          for (const frag of delta.tool_calls) {
            const existing = fragments.get(frag.index) ?? { id: '', name: '', arguments: '' };
            if (frag.id) existing.id = frag.id;
            if (frag.function?.name) existing.name += frag.function.name;
            if (frag.function?.arguments) existing.arguments += frag.function.arguments;
            fragments.set(frag.index, existing);
          }
        }
        if (choice?.finish_reason === 'tool_calls') {
          sawToolFinish = true;
        }
        if (chunk.usage && opts.onUsage) {
          opts.onUsage({
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          });
        }
      }
    }
  } catch (err) {
    if (timedOut()) {
      throw new HttpError(504, '模型服务响应超时，请稍后重试');
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }

  if (sawToolFinish && fragments.size > 0) {
    const calls = [...fragments.entries()]
      .sort(([a], [b]) => a - b)
      .map(([i, call]) => ({ ...call, id: call.id || `call_${i}` }));
    yield { type: 'tool_calls', calls };
  }
}
