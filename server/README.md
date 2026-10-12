# server/ —— 后端 BFF（Backend for Frontend）

这个文件夹是整个项目的"大脑"：一个用 **Node.js + Express + TypeScript** 写的后端服务，监听 **3001** 端口。前端的每个请求都打到它这里，它负责登录鉴权、文档入库、向量检索、调用大模型、把流式回答推回浏览器。

## 它在整个系统里的位置

```
浏览器（web/ 前端）
   │  HTTP / SSE
   ▼
┌───────────────  server/（本文件夹，端口 3001） ───────────────┐
│  Express 路由 → 中间件（日志/鉴权） → 服务层 → 数据层          │
└────────┬──────────────────┬──────────────────┬───────────────┘
         ▼                  ▼                  ▼
  PostgreSQL+pgvector   通义千问 Qwen        Tavily 联网搜索
  （存文档和向量）      （对话+向量化）      （可选，配 Key 才启用）
```

> **BFF 是什么？** Backend for Frontend，"专门伺候前端的轻后端"。它不直接面向终端用户，而是把数据库、大模型、搜索这些零散能力组装成前端正好需要的接口形状。相比"一个巨型后端服务所有端"，BFF 小而聚焦，改起来快。

## 目录结构（每个文件干什么）

```
server/
├── src/
│   ├── index.ts          # 启动入口：读端口配置 → 组装 app → 监听 3001
│   ├── app.ts            # Express 应用组装：注册中间件和路由、托管前端静态文件
│   ├── config.ts         # 环境变量集中读取（.env 文件在这里变成代码能用的配置对象）
│   ├── routes/           # ★ 接口层：每个文件导出一个 Router，一个文件管一类接口
│   │   ├── health.ts     #   GET /api/health 健康检查（Docker/nginx 探活用）
│   │   ├── auth.ts       #   注册 / 登录 / 当前用户 / 登出
│   │   ├── chat.ts       #   POST /api/chat —— SSE 流式问答（项目核心）
│   │   ├── upload.ts     #   POST /api/upload 上传文档（仅 admin）
│   │   ├── documents.ts  #   文档列表 / 删除
│   │   ├── audit.ts      #   审计日志查询（仅 admin）
│   │   └── usage.ts      #   Tavily 联网搜索剩余额度（前端徽标）
│   ├── services/         # ★ 服务层：真正干活的地方，路由只做"收参数+调服务+回结果"
│   │   ├── agent.ts      #   Agent 循环：模型自主决定调不调工具、调几次
│   │   ├── qwenChat.ts   #   千问 API 封装（OpenAI 兼容协议、流式、tool_calls 拼装）
│   │   ├── embedding.ts  #   文字→向量（text-embedding-v3，1024 维）
│   │   ├── retrieval.ts  #   pgvector 余弦相似度 Top-K 检索
│   │   ├── tools.ts      #   工具说明书（给模型看）+ 工具执行
│   │   ├── webSearch.ts  #   Tavily 联网搜索封装（含额度查询+60s 缓存）
│   │   ├── ingestion.ts  #   入库编排：解析→分块→向量化→写库 一条龙
│   │   ├── documentParser.ts # pdf/md/txt 文件 → 纯文本
│   │   ├── chunker.ts    #   长文本切块（800 字/块，相邻块重叠 100 字）
│   │   ├── auth.ts       #   scrypt 密码哈希 + JWT 签发校验
│   │   ├── audit.ts      #   审计日志落库
│   │   └── logger.ts     #   pino 日志（开发彩色控制台 + 生产 JSON 文件）
│   ├── middlewares/      # Express"关卡"：请求进路由前先过这里
│   │   ├── auth.ts       #   requireAuth（验 JWT）/ requireRole（验角色）
│   │   ├── requestLogger.ts # 每个请求记一行日志
│   │   └── errorHandler.ts  # 统一错误处理 + 404 兜底
│   ├── db/               # 数据层：SQL 都在这
│   │   ├── index.ts      #   pg 连接池
│   │   ├── schema.ts     #   建表 SQL（启动时自动执行）
│   │   ├── documents.ts  #   文档表 CRUD
│   │   └── vector.ts     #   向量块表 CRUD（含相似度检索）
│   ├── types/            # TS 类型声明
│   │   └── pdf-parse.d.ts #  pdf-parse 库没自带类型，手写"补丁"
│   └── utils/            # 小工具
│       ├── response.ts   #   ok()/fail() 统一响应体（前后端的契约）
│       └── asyncHandler.ts # async 错误包装器（不包的话 async 路由抛错会挂起请求）
├── scripts/              # 生成测试用 PDF 的脚本
├── uploads/              # 上传的原始文件落盘目录
├── logs/                 # 运行日志（JSON 格式，已 gitignore）
└── tsconfig.json         # TypeScript 编译配置
```

## 一次提问在后端走过的完整路线

以「差旅费报销的每日限额是多少？」为例：

1. **`POST /api/chat`**（routes/chat.ts）收到请求，先过 `requireAuth` 中间件验 JWT。
2. 空知识库兜底检查：库里一个文档都没有就直接发"引导上传"事件结束，不浪费模型调用。
3. 进入 **Agent 循环**（services/agent.ts）：把系统提示词 + 用户问题发给千问（qwenChat.ts）。
4. 模型回答「我要调工具」→ `search_knowledge`（tools.ts）→ retrieval.ts 用余弦相似度从 pgvector 捞出最相关的 5 个文本块（`[1]`~`[5]`）。
5. 检索结果塞回对话历史，再问模型；模型这次直接流式吐字，每个字通过 **SSE** 的 `delta` 事件实时推给浏览器（打字机效果）。
6. 全部说完发 `done` 事件（附 token 用量）。前端点击 `[n]` 引用能对应到来源卡。

需要实时信息（股价、新闻）时，模型会改调 `web_search` 工具走 Tavily——是否挂这个工具取决于环境变量里有没有 `TAVILY_API_KEY`。

## API 接口一览

统一响应格式（utils/response.ts 定义）：`{ code: 0, data: ..., message: 'ok' }`，`code !== 0` 即失败。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 公开 | 健康检查，返回 uptime |
| POST | `/api/auth/register` | 公开 | 注册（用户名 3-32 字符，密码≥6 位），返回 JWT |
| POST | `/api/auth/login` | 公开 | 登录，返回 JWT + 用户信息 |
| GET | `/api/auth/me` | 登录 | 当前用户信息 |
| POST | `/api/auth/logout` | 登录 | 登出（落审计日志） |
| POST | `/api/chat` | 登录 | SSE 流式问答，请求体 `{ message: string }` |
| POST | `/api/upload` | **admin** | 上传文档（multipart 字段 `file`，≤10MB，.pdf/.md/.markdown/.txt） |
| GET | `/api/documents` | 登录 | 文档列表（含分块数） |
| DELETE | `/api/documents/:id` | **admin** | 删除文档（连带删向量） |
| GET | `/api/audit` | **admin** | 审计日志列表 |
| GET | `/api/usage` | 登录 | Tavily 联网搜索剩余额度（60 秒缓存） |

## SSE 流式协议（chat 接口专属）

普通接口"一次给全部结果"，聊天接口"想到一个字就发一个字"。报文是手写的，一帧长这样（空行表示帧结束）：

```
event: delta
data: {"content":"报销"}

```

| 事件 | data 内容 | 时机 |
| --- | --- | --- |
| `sources` | 来源数组（知识库片段/网页） | 每次工具执行完 |
| `tool` | `{ name, args, status }`，status=running/done | 工具开始/结束 |
| `delta` | `{ content: "一小段文字" }` | 模型每吐一段 |
| `done` | `{ usage: { promptTokens, completionTokens, totalTokens } }` | 回答完毕 |
| `error` | `{ message }` | 出错（含 504 超时降级） |

前端消费端实现在 `web/src/api.ts` 的 `streamChat`。

## 环境变量（server/.env）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `QWEN_API_KEY` | （必填） | 阿里云 DashScope Key，[控制台](https://dashscope.console.aliyun.com/)申请 |
| `JWT_SECRET` | （必填） | JWT 签名密钥，`openssl rand -hex 32` 生成 |
| `DATABASE_URL` | `postgres://kba:kba123456@localhost:5432/knowledge_base` | 数据库连接串 |
| `PORT` | `3001` | 监听端口 |
| `TAVILY_API_KEY` | （空） | 联网搜索 Key，留空则 `web_search` 工具不注册 |
| `QWEN_CHAT_MODEL` | `qwen-plus` | 对话模型 |
| `QWEN_EMBEDDING_MODEL` / `QWEN_EMBEDDING_DIM` | `text-embedding-v3` / `1024` | 嵌入模型与维度 |
| `RAG_TOP_K` | `5` | 检索返回最相关的几块 |
| `AGENT_MAX_TOOL_ROUNDS` | `3` | Agent 工具调用最大轮数（防死循环） |
| `CHAT_TIMEOUT_MS` | `30000` | 模型流式空闲超时（超时返回 504 友好提示） |
| `EMBEDDING_TIMEOUT_MS` | `15000` | 向量化超时 |
| `JWT_EXPIRES_IN` | `12h` | token 有效期 |
| `UPLOAD_DIR` / `MAX_FILE_SIZE_MB` | `uploads` / `10` | 上传目录与大小限制 |
| `LOG_LEVEL` / `LOG_FILE` | `info` / `logs/app.log` | 日志级别与文件 |

**安全提醒**：`.env` 已被 gitignore，任何 Key 都绝不提交进仓库。

## 本地开发

```bash
cd server
cp .env.example .env     # 填 QWEN_API_KEY 和 JWT_SECRET
npm install
npm run dev              # tsx 热重载启动，http://localhost:3001
```

首次启动自动完成：建表 + 建 pgvector 索引 + 种子账号（users 表为空时创建 `admin/admin123`、`demo/demo123`）。

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发模式（tsx watch，改代码自动重启） |
| `npm run typecheck` | 只查类型错误，不产出文件 |
| `npm run build` | 编译到 `dist/`（生产用） |
| `npm start` | 运行编译产物 `node dist/index.js` |

## 构建与部署

生产环境用根目录的 [Dockerfile](../Dockerfile) 多阶段构建：`npm ci` → `tsc` → `npm prune --omit=dev`（删掉开发依赖减小镜像）→ 以非 root 的 `node` 用户运行。完整部署流程见 [docs/deployment.md](../docs/deployment.md)。

## 排查问题速查

```bash
curl http://localhost:3001/api/health        # 服务活着吗
tail -f logs/app.log                          # 看实时日志（JSON 格式）
```

常见症状 → 线索：JWT 莫名 401 → 先查服务器时钟同步（`timedatectl`）；SSE 中途断 → 查 `CHAT_TIMEOUT_MS` 是否被流式空闲触发。

## 延伸阅读

- 全项目变更详解（小白向）：[docs/changes.md](../docs/changes.md)
- 技术文章《用 Node.js BFF 搭建 RAG 知识库系统》：[docs/article.md](../docs/article.md)
