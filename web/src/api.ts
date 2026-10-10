import { authHeader, clearAuth, notifyUnauthorized } from './auth';
import type { AuditEntry, AuthState, DocumentInfo, Source, Usage } from './types';

export interface ChatCallbacks {
  onSources?: (sources: Source[]) => void;
  onDelta?: (content: string) => void;
  onTool?: (name: string, args: Record<string, unknown>, status: 'running' | 'done') => void;
  onDone?: (usage: Usage | null) => void;
  onError?: (message: string) => void;
}

interface ApiEnvelope<T> {
  code: number;
  data: T;
  message: string;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { ...authHeader(), ...(options.headers ?? {}) },
  });
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

function handleBlock(block: string, cb: ChatCallbacks): void {
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return;

  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return;
  }

  if (event === 'sources') cb.onSources?.(payload as Source[]);
  else if (event === 'delta') cb.onDelta?.((payload as { content: string }).content ?? '');
  else if (event === 'tool') {
    const t = payload as { name: string; args: Record<string, unknown>; status: 'running' | 'done' };
    cb.onTool?.(t.name, t.args ?? {}, t.status);
  } else if (event === 'done') cb.onDone?.(((payload as { usage?: Usage }).usage as Usage) ?? null);
  else if (event === 'error') cb.onError?.((payload as { message?: string }).message ?? '未知错误');
}

export async function streamChat(
  message: string,
  cb: ChatCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ message }),
    signal,
  });

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

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (block.trim()) handleBlock(block, cb);
      sep = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) handleBlock(buffer, cb);
}
