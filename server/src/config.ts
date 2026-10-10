import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 3001),
  qwen: {
    apiKey: process.env.QWEN_API_KEY ?? '',
    baseUrl:
      process.env.QWEN_BASE_URL ??
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    embeddingModel: process.env.QWEN_EMBEDDING_MODEL ?? 'text-embedding-v3',
    embeddingDim: Number(process.env.QWEN_EMBEDDING_DIM ?? 1024),
    chatModel: process.env.QWEN_CHAT_MODEL ?? 'qwen-plus',
  },
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://kba:kba123456@localhost:5432/knowledge_base',
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB ?? 10),
  chunk: {
    maxChars: 800,
    overlapChars: 100,
  },
  rag: {
    topK: Number(process.env.RAG_TOP_K ?? 5),
  },
  webSearch: {
    tavilyApiKey: process.env.TAVILY_API_KEY ?? '',
  },
  agent: {
    maxToolRounds: Number(process.env.AGENT_MAX_TOOL_ROUNDS ?? 3),
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  },
  log: {
    level: process.env.LOG_LEVEL ?? 'info',
    file: process.env.LOG_FILE ?? 'logs/app.log',
  },
  timeout: {
    chatIdleMs: Number(process.env.CHAT_TIMEOUT_MS ?? 30000),
    embeddingMs: Number(process.env.EMBEDDING_TIMEOUT_MS ?? 15000),
  },
} as const;
