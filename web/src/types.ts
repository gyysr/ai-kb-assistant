export interface Source {
  index: number;
  kind: 'kb' | 'web';
  documentId?: number;
  filename: string;
  chunkIndex?: number;
  url?: string;
  score: number;
  snippet: string;
}

export interface ToolStep {
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'done';
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  tools?: ToolStep[];
  usage?: Usage | null;
  streaming?: boolean;
  error?: string;
}

export interface AuthUser {
  id: number | string;
  username: string;
  role: 'admin' | 'user';
}

export interface AuthState {
  token: string;
  user: AuthUser;
}

export interface DocumentInfo {
  id: number | string;
  filename: string;
  fileType: string;
  fileSize: number;
  chunkCount: number;
  createdAt: string;
}

export interface AuditEntry {
  id: number | string;
  userId: string | null;
  username: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}
