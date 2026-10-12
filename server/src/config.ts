// ===== 配置中心：所有环境变量集中在这一个文件读取 =====
// 为什么要集中：配置散落在各文件里的话，改一个默认值要全局搜半天还容易漏；
// 集中后其他代码只 import 这里的 config，环境变量名只在本文出现一次，
// 想改默认值、加配置都只动这一个文件。
// 下一行的 dotenv 会把 server/.env 里的键值对读进 process.env——
// 本地开发改 .env 立即生效，不用动代码；每个 ?? 后面是未配置时的默认值
import 'dotenv/config';

// as const 让 TS 把这些值当具体字面量（而非宽泛的 string/number），
// 引用处的类型更精确；也顺带表明态度：这是只读配置，运行期不该被改
export const config = {
  // HTTP 监听端口（PORT），默认 3001
  port: Number(process.env.PORT ?? 3001),
  qwen: {
    // 通义千问 API 密钥（QWEN_API_KEY）。空 = 未配置，调模型时会明确报错
    apiKey: process.env.QWEN_API_KEY ?? '',
    // 模型服务地址（QWEN_BASE_URL），默认官方 dashscope 的 OpenAI 兼容入口
    baseUrl:
      process.env.QWEN_BASE_URL ??
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    // 向量化模型名（QWEN_EMBEDDING_MODEL）：把文字转成向量，供语义检索用
    embeddingModel: process.env.QWEN_EMBEDDING_MODEL ?? 'text-embedding-v3',
    // 向量维度（QWEN_EMBEDDING_DIM）：必须与建表语句 vector(1024) 的维度一致
    embeddingDim: Number(process.env.QWEN_EMBEDDING_DIM ?? 1024),
    // 对话模型名（QWEN_CHAT_MODEL），默认 qwen-plus
    chatModel: process.env.QWEN_CHAT_MODEL ?? 'qwen-plus',
  },
  // PostgreSQL 连接串（DATABASE_URL），默认指向本机 Docker 里那套库
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://kba:kba123456@localhost:5432/knowledge_base',
  // 上传文件落盘目录（UPLOAD_DIR），相对 server/ 目录
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  // 单个上传文件的大小上限（MAX_FILE_SIZE_MB），单位 MB，默认 10
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB ?? 10),
  chunk: {
    // 文档分块：每块最大字符数。太大检索不精准，太小上下文太碎
    maxChars: 800,
    // 相邻块的重叠字符数：防止关键句子恰好被切断在两块边界上
    overlapChars: 100,
  },
  rag: {
    // 每次提问取最相似的块数（RAG_TOP_K），默认 5
    topK: Number(process.env.RAG_TOP_K ?? 5),
  },
  webSearch: {
    // 联网搜索 Tavily 的密钥（TAVILY_API_KEY），留空则 web_search 工具自动禁用
    tavilyApiKey: process.env.TAVILY_API_KEY ?? '',
  },
  agent: {
    // Agent 连续调用工具的最大轮数（AGENT_MAX_TOOL_ROUNDS）：防模型死循环烧 token
    maxToolRounds: Number(process.env.AGENT_MAX_TOOL_ROUNDS ?? 3),
  },
  jwt: {
    // 登录令牌的签名密钥（JWT_SECRET）：为空则 index.ts 启动时直接拒绝启动
    secret: process.env.JWT_SECRET ?? '',
    // 令牌有效期（JWT_EXPIRES_IN），默认 12h，过期需重新登录
    expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  },
  log: {
    // 日志级别（LOG_LEVEL）：debug / info / warn / error
    level: process.env.LOG_LEVEL ?? 'info',
    // 日志文件路径（LOG_FILE）
    file: process.env.LOG_FILE ?? 'logs/app.log',
  },
  timeout: {
    // 模型流式输出的空闲超时（CHAT_TIMEOUT_MS）：太久没吐新字就中止并给 504 提示
    chatIdleMs: Number(process.env.CHAT_TIMEOUT_MS ?? 30000),
    // 向量化请求的超时（EMBEDDING_TIMEOUT_MS）
    embeddingMs: Number(process.env.EMBEDDING_TIMEOUT_MS ?? 15000),
  },
} as const;
