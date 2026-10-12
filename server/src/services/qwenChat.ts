// ===== 千问流式对话：调 DashScope 的 OpenAI 兼容接口（compatible-mode/v1）=====
// 用 OpenAI 的请求/响应格式调阿里通义千问，不必另学一套私有协议。
// "流式" = 模型边生成边往回吐小块（chunk），前端逐字显示，而不是憋十几秒蹦一整段。
// 同时支持 function calling：模型可在回答中途请求调用工具（tools.ts 定义的工具），
// 由 services/agent.ts 的循环消费本模块吐出的事件。
import { config } from '../config';
import { HttpError } from '../utils/response';

// token 用量统计（计费/观测用）：流式模式要显式请求，接口才会在最后一个 chunk 里捎上
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// 一条"工具说明书"（OpenAI function calling 协议格式），具体内容由 tools.ts 生成
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// 模型发出的"我要调用某工具"的声明；arguments 是尚未解析的 JSON 字符串
export interface ToolCallSpec {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

// 一条对话消息。role 四种：system 给模型下设定 / user 用户提问 / assistant 模型回复 / tool 工具结果回传
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

// 本模块对外吐的两种事件：正文文本片段，或"模型请求调用工具"（含拼装完整的调用列表）
export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_calls'; calls: ToolCall[] };

// 工具调用的"碎片"：流式接口里一次调用可能被拆成多段到达，先按这个形状收着
interface ToolCallFragment {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

// SSE 每行 data: 后面跟的那段 JSON 的形状
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

// 组装请求体：stream 固定开启；usage 统计与 tools 按需条件展开（没有工具就不带 tools 字段）
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

// 发起对话请求（POST /chat/completions），返回尚未读取的响应流
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

// 核心生成器：调用方用 for await 逐个消费 text / tool_calls 事件
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

  // 用"空闲超时"而非总时长超时：模型只要还在吐字就不断续期计时器，
  // 只有彻底卡住超过 chatIdleMs 才掐断——长回答不会被误杀
  const idleMs = config.timeout.chatIdleMs;
  // 客户端断开（外层 signal）与模型空闲超时共用一个控制器；
  // 超时用带原因的 abort，便于和普通 AbortError 区分
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | null = null;
  // （重新）武装计时器：每收到新数据都会先调它一次，相当于把倒计时归零
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

  // 工具调用"增量拼装"的容器：以 index 为键，把分散到达的碎片攒成完整调用
  const fragments = new Map<number, ToolCall>();
  let sawToolFinish = false;

  try {
    // 逐 chunk 读取响应体：reader.read() 每次吐一段原始字节，decoder 负责解码成文本
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    // 攒行缓冲：一个网络包可能带多条 SSE 消息，也可能只有半条，先攒着再按换行切
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
        // SSE 协议：一行一条事件，只有 data: 前缀的才是数据，其余行直接跳过
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        // [DONE] 是流结束标记，不是数据
        if (payload === '[DONE]') continue;

        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(payload) as StreamChunk;
        } catch {
          // 个别坏行解析失败就跳过——不能让一条脏数据杀死整条流
          continue;
        }

        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        // 正文片段：立刻 yield 给调用方，前端就能逐字上屏
        if (delta?.content) {
          yield { type: 'text', content: delta.content };
        }
        // 工具调用碎片：函数名和参数 JSON 可能被拆成好几段到达，这里逐段追加（+=）
        // 拼装，拼完整才能解析执行——这正是上面 fragments Map 存在的原因
        if (delta?.tool_calls) {
          for (const frag of delta.tool_calls) {
            const existing = fragments.get(frag.index) ?? { id: '', name: '', arguments: '' };
            if (frag.id) existing.id = frag.id;
            if (frag.function?.name) existing.name += frag.function.name;
            if (frag.function?.arguments) existing.arguments += frag.function.arguments;
            fragments.set(frag.index, existing);
          }
        }
        // finish_reason = tool_calls：模型本轮以"请求调用工具"收尾的标记
        if (choice?.finish_reason === 'tool_calls') {
          sawToolFinish = true;
        }
        // 最后一个 chunk 捎带的用量统计，回调给调用方记账
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

  // 流读完后：若模型请求过工具调用，把拼装完整的调用列表一次性吐出，交给 Agent 循环执行
  if (sawToolFinish && fragments.size > 0) {
    const calls = [...fragments.entries()]
      .sort(([a], [b]) => a - b)
      .map(([i, call]) => ({ ...call, id: call.id || `call_${i}` }));
    yield { type: 'tool_calls', calls };
  }
}
