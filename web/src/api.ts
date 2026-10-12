import { authHeader, clearAuth, notifyUnauthorized } from './auth';
import type { AuditEntry, AuthState, DocumentInfo, Source, Usage, UsageSummary } from './types';

// 聊天过程的四类回调：来源列表到达 / 一个文字片段到达 / 工具开始或结束 / 全部完成
export interface ChatCallbacks {
  onSources?: (sources: Source[]) => void;
  onDelta?: (content: string) => void;
  onTool?: (name: string, args: Record<string, unknown>, status: 'running' | 'done') => void;
  onDone?: (usage: Usage | null) => void;
  onError?: (message: string) => void;
}

// 后端所有接口的统一返回格式：{code: 0 表示成功, data: 真正的数据, message: 出错时的提示}
interface ApiEnvelope<T> {
  code: number;
  data: T;
  message: string;
}

// dev 下 BASE_URL 为 '/'，prod 构建传 --base=/kb/ 时自动带前缀。
// 好处：同一份代码，本地和服务器上 API 地址自动各归各位，不用手改
const API_BASE = `${import.meta.env.BASE_URL}api`;

// 所有普通（非流式）请求的公共入口：自动带登录 token、统一解析响应、统一处理 401
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    // authHeader() 每次现取 localStorage 的 token —— 登录/换号后无需刷新页面
    headers: { ...authHeader(), ...(options.headers ?? {}) },
  });
  // 401 = token 过期/无效。统一处理：清掉本地登录态，广播一个"未授权"事件
  // （App.tsx 监听它，自动跳回登录页）。各接口不用自己写这套逻辑
  if (res.status === 401 && !path.startsWith('/auth/')) {
    clearAuth();
    notifyUnauthorized();
    throw new Error('登录已过期，请重新登录');
  }
  let body: ApiEnvelope<T>;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new Error(`请求失败（HTTP ${res.status}）`);
  }
  if (!res.ok || body.code !== 0) {
    throw new Error(body.message ?? `请求失败（HTTP ${res.status}）`);
  }
  return body.data;
}

export async function login(username: string, password: string): Promise<AuthState> {
  return request<AuthState>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export async function register(username: string, password: string): Promise<AuthState> {
  return request<AuthState>('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export async function logout(): Promise<void> {
  try {
    await request('/auth/logout', { method: 'POST' });
  } catch {
    // 登出接口失败不阻塞前端退出
  }
}

export async function listDocuments(): Promise<DocumentInfo[]> {
  return request<DocumentInfo[]>('/documents');
}

export async function deleteDocument(id: number | string): Promise<void> {
  await request(`/documents/${id}`, { method: 'DELETE' });
}

export async function uploadDocument(
  file: File,
): Promise<{ documentId: string; filename: string; chunkCount: number }> {
  const form = new FormData();
  form.append('file', file);
  return request('/upload', { method: 'POST', body: form });
}

export async function listAudit(): Promise<AuditEntry[]> {
  return request<AuditEntry[]>('/audit');
}

export async function getUsage(): Promise<UsageSummary> {
  return request<UsageSummary>('/usage');
}

// ===== SSE（服务器推送事件）解析 =====
// 聊天接口不走 request()，因为它是"流式"的：服务器想到一个字就发一个字，
// fetch 的普通响应做不到这一点，所以要用专门的读法（见 streamChat）。
//
// SSE 的一帧长这样（后端 server/src/routes/chat.ts 里 res.write 发出来的）：
//   event: delta\n
//   data: {"content":"报销"}\n
//   \n            ← 空行表示一帧结束
// 这个函数的任务：把一帧文本拆出 event 名和 data JSON，再分发给对应回调
function handleBlock(block: string, cb: ChatCallbacks): void {
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    // 一帧里 "event:" 行决定类型，"data:" 行是内容
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return;

  // data 是 JSON 字符串，转回对象；转不动（网络抖动半帧）就整帧丢弃，
  // 少一个字总比渲染出乱码好
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return;
  }

  // 按事件类型分发给上层（ChatPanel 传入的回调）
  if (event === 'sources') cb.onSources?.(payload as Source[]);
  else if (event === 'delta') cb.onDelta?.((payload as { content: string }).content ?? '');
  else if (event === 'tool') {
    const t = payload as { name: string; args: Record<string, unknown>; status: 'running' | 'done' };
    cb.onTool?.(t.name, t.args ?? {}, t.status);
  } else if (event === 'done') cb.onDone?.(((payload as { usage?: Usage }).usage as Usage) ?? null);
  else if (event === 'error') cb.onError?.((payload as { message?: string }).message ?? '未知错误');
}

// 发起聊天并"边收边回调"。signal 是停止按钮的关键：
// AbortController.abort() 会让这里正在等数据的 fetch 直接抛 AbortError，流就断了
export async function streamChat(
  message: string,
  cb: ChatCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    // 注意字段名是 message —— 后端路由校验的就是这个名字
    body: JSON.stringify({ message }),
    signal,
  });

  // 走到这里说明 HTTP 层就失败了（4xx/5xx）。流式接口的错误体也尝试读一下，
  // 读不到就用默认文案；401 同样触发"清登录态 + 回登录页"
  if (!res.ok || !res.body) {
    let msg = `请求失败（HTTP ${res.status}）`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) msg = body.message;
    } catch {
      // 非 JSON 错误体，保留默认信息
    }
    if (res.status === 401) {
      clearAuth();
      notifyUnauthorized();
    }
    cb.onError?.(msg);
    return;
  }

  // ===== 逐块读取响应体 =====
  // res.body 是个 ReadableStream：网络传来多少就能读多少，不用等全部到齐。
  // reader.read() 每次返回一段字节（value）+ 是否读完了（done）
  const reader = res.body.getReader();
  // 字节 → 文字。stream:true 告诉解码器"一个中文可能被拆在两段字节里"，先攒着别急着解
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // 一帧以"空行（\n\n）"结尾。刚收到的字节可能含半帧、也可能含好几帧，
    // 所以用 while 把 buffer 里所有"完整的帧"都切出来处理，剩下的半帧留在 buffer 里
    // 等下一轮网络数据到了再拼
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (block.trim()) handleBlock(block, cb);
      sep = buffer.indexOf('\n\n');
    }
  }
  // 流正常结束时可能还剩最后一帧没有空行收尾，补处理一次
  if (buffer.trim()) handleBlock(buffer, cb);
}
