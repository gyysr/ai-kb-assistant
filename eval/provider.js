// promptfoo 自定义 provider：登录知识库 BFF，调用 /api/chat 并解析 SSE
const BASE_URL = process.env.EVAL_BASE_URL || 'http://localhost:3001';
const USERNAME = process.env.EVAL_USERNAME || 'demo';
const PASSWORD = process.env.EVAL_PASSWORD || 'demo123';

let cachedToken = null;

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

async function readSse(res) {
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
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

class KbRagProvider {
  id() {
    return 'kb-rag';
  }

  async callApi(prompt) {
    const startedAt = Date.now();
    let events = null;
    for (let attempt = 0; attempt < 2 && events === null; attempt++) {
      const token = cachedToken || (await login());
      events = await chatOnce(token, prompt);
    }
    if (events === null) {
      throw new Error('登录态失效且重试后仍未成功');
    }

    const errorEvent = events.find((e) => e.event === 'error');
    if (errorEvent) {
      throw new Error(`服务返回错误: ${errorEvent.data?.message || 'unknown'}`);
    }

    const output = events
      .filter((e) => e.event === 'delta')
      .map((e) => e.data?.content ?? '')
      .join('');
    const doneEvent = events.find((e) => e.event === 'done');
    const usage = doneEvent?.data?.usage || null;

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

module.exports = KbRagProvider;
