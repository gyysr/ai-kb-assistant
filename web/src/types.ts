// ===== 前端数据类型清单：所有数据的"图纸" =====
// 类型（interface）= 数据的图纸：约定一个对象有哪些字段、各是什么类型。
// 这里的字段名和后端接口返回的 JSON 一一对应，前后端靠它说同一种"语言"。
// 本文件只有约定、没有运行逻辑 —— 字段对不上 TS 编译期就报错，不用等页面出事

// 一条引用来源：回答末尾 [1][2] 角标背后的数据（来自知识库或联网搜索）
export interface Source {
  // 角标编号，对应正文里的 [n]
  index: number;
  // 来源类型：kb = 知识库检索，web = 联网搜索
  kind: 'kb' | 'web';
  // 知识库文档的 id。带 ? 的字段是"可选"：web 来源就没有这个字段
  documentId?: number;
  // 来源文件名（web 来源则是结果标题）
  filename: string;
  // 引用的是文档切分后的第几段（RAG 会把长文档切成小段再检索）
  chunkIndex?: number;
  // web 来源的原文链接
  url?: string;
  // 相似度得分：越高说明这段内容和问题越相关
  score: number;
  // 原文摘录 —— 鼠标悬停角标时看到的那段文字
  snippet: string;
}

// 检索工具的一次执行过程（界面里"正在检索知识库…"这类过程提示的数据）
export interface ToolStep {
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'done';
}

// 一次回答消耗的 token 数。token 是大模型的计费单位，约等于半个词
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// 聊天记录里的一条消息（用户提问或 AI 回答）。
// 字段名后带 ? = 可选字段：比如提问就没有 sources，没答完就没有 usage
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  tools?: ToolStep[];
  usage?: Usage | null;
  streaming?: boolean;
  error?: string;
}

// 当前登录的用户信息（token 不在这里，单独放 AuthState）
export interface AuthUser {
  id: number | string;
  username: string;
  // 角色：admin 能管文档、看审计日志，user 只能聊天
  role: 'admin' | 'user';
}

// 完整登录态 = token + 用户信息。auth.ts 存进 localStorage 的就是这一份
export interface AuthState {
  token: string;
  user: AuthUser;
}

// 文档管理列表里的一行：上传的每个 PDF/Markdown 在知识库里的"户口页"
export interface DocumentInfo {
  id: number | string;
  filename: string;
  fileType: string;
  fileSize: number;
  chunkCount: number;
  createdAt: string;
}

// 审计日志表格里的一行：谁、什么时候、做了什么操作。由后端自动记录
export interface AuditEntry {
  id: number | string;
  userId: string | null;
  // null = 操作者没登录/查不到（比如登录失败的尝试）
  username: string | null;
  // 操作代码（login、document_upload…），AuditPanel 会翻成中文标签
  action: string;
  // 操作附加信息（如上传的文件名）。结构随操作变化，所以是宽松类型
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

// 联网搜索（Tavily）的额度信息，App 顶部那个徽标展示用的数据
export interface WebSearchQuota {
  enabled: boolean;
  plan?: string;
  used?: number;
  limit?: number | null;
}

// /api/usage 接口的返回形状：目前只装联网搜索额度一项
export interface UsageSummary {
  webSearch: WebSearchQuota;
}
