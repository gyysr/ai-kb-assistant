// ===== promptfoo 自定义 provider：把评测框架接上我们的系统 =====
// promptfoo 自带的本事是调各种大模型 API；但被测对象是自家 BFF —— 要 JWT
// 登录、回答还是 SSE 流式吐出来的。这个文件教 promptfoo 三步：
// 登录拿 token → 发问题 → 把流式片段拼成完整回答交回框架判定。
// promptfoo 自定义 provider：登录知识库 BFF，调用 /api/chat 并解析 SSE

// 评测目标的地址和账号，可用环境变量覆盖（比如评测线上环境）。
// 默认连本机 dev 服务、用 demo 普通账号 —— 不用 admin，避免评测流量
// 在审计日志里冒充管理员操作
const BASE_URL = process.env.EVAL_BASE_URL || 'http://localhost:3001';
const USERNAME = process.env.EVAL_USERNAME || 'demo';
const PASSWORD = process.env.EVAL_PASSWORD || 'demo123';

// 登录一次后缓存的 JWT，所有题目共用；收到 401 时会被清空、触发重新登录
let cachedToken = null;

// 调登录接口换一个 JWT。评测脚本是个"机器用户"，走的和浏览器登录
// 完全是同一个接口，保证测的就是真实链路
async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`登录失败: ${res.status}`);
  }
  const json = await res.json();
  cachedToken = json.data.token;
  return cachedToken;
}

// 读取 SSE 流，把所有事件收进一个数组返回。解析逻辑和前端 api.ts 同款
// （帧以空行 \n\n 分隔、event:/data: 两行、data 是 JSON），区别在于前端
// 是"边收边渲染打字机效果"，评测不需要 —— 攒齐了最后统一处理
async function readSse(res) {
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // buffer 用来攒"半帧"：网络一次给的字节可能不够一整帧（甚至把一个
  // 中文拆成两半），先攒着，等凑够"空行结尾"再切出来处理
  let buffer = '';
  for (;;) {
    // 每次读到一段新字节就追加进 buffer，然后把里面所有完整的帧切出来
    const { done, value } = await reader.read();
    if (done) break;
    // stream:true 告诉解码器"先别急着解，可能有字被拆在两段字节里"
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      try {
        events.push({ event, data: data ? JSON.parse(data) : null });
      } catch {
        // 忽略无法解析的块
      }
    }
  }
  return events;
}

// 带着 token 问一个问题，返回解析好的事件数组。注意 401 的特殊处理：
// 不直接抛错，而是返回 null —— 把"登录态失效"这个信号交给上层，
// 由它重新登录后再重试（见 callApi 里的循环）
async function chatOnce(token, question) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: question }),
  });
  if (res.status === 401) {
    cachedToken = null;
    return null;
  }
  if (!res.ok || !res.body) {
    throw new Error(`chat 请求失败: ${res.status}`);
  }
  return readSse(res);
}

// promptfoo 的 file:// provider 有个硬约定：文件必须导出一个 class，
// 框架会 new 它，然后对每道题调一次 callApi。导出普通函数或对象都不行
class KbRagProvider {
  // id 显示在评测结果里，用来标识被测系统（报告里叫 kb-rag）
  id() {
    return 'kb-rag';
  }

  // 每道题被调用一次，prompt 参数就是 YAML 里 vars 填的问题文本
  async callApi(prompt) {
    // 记开始时间，结束时算出本题延迟（promptfoo 会记进结果）
    const startedAt = Date.now();
    let events = null;
    // 最多两轮"登录 → 提问"：第一轮用缓存 token；若 token 过期收到 401
    // （chatOnce 返回 null），第二轮重新登录再问一次。两次都不行才放弃
    for (let attempt = 0; attempt < 2 && events === null; attempt++) {
      const token = cachedToken || (await login());
      events = await chatOnce(token, prompt);
    }
    if (events === null) {
      throw new Error('登录态失效且重试后仍未成功');
    }

    // 流里出现 error 事件 = 服务端处理出错，抛出去让本题记为失败
    const errorEvent = events.find((e) => e.event === 'error');
    if (errorEvent) {
      throw new Error(`服务返回错误: ${errorEvent.data?.message || 'unknown'}`);
    }

    // 把所有 delta 事件的文字片段按到达顺序拼接 = 模型的完整回答。
    // 这正是前端打字机效果在评测端的等价物：前端边收边显示，这里收完一次拼
    const output = events
      .filter((e) => e.event === 'delta')
      .map((e) => e.data?.content ?? '')
      .join('');
    // done 事件是流的最后一步，里面带本题的 token 消耗
    const doneEvent = events.find((e) => e.event === 'done');
    const usage = doneEvent?.data?.usage || null;

    // promptfoo 认识的返回格式：output 是回答正文（给断言和 LLM 裁判用），
    // latencyMs/tokenUsage 会被记进 results.json，供 summarize.js 算指标
    const result = {
      output: output || '（模型未返回内容）',
      latencyMs: Date.now() - startedAt,
    };
    if (usage) {
      result.tokenUsage = {
        prompt: usage.promptTokens ?? 0,
        completion: usage.completionTokens ?? 0,
        total: usage.totalTokens ?? 0,
      };
    }
    return result;
  }
}

// CommonJS 导出：promptfoo 用 require() 加载这个文件，拿到这个 class
module.exports = KbRagProvider;
