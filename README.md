# AI 知识库问答助手（RAG）

基于 **Node.js BFF + React + PostgreSQL/pgvector + 通义千问（Qwen）** 的企业知识库问答系统，覆盖 RAG 全链路：文档解析入库 → 向量检索 → Agent 工具调用 → SSE 流式回答（带引用标注）→ 权限审计 → 监控降级 → promptfoo 自动化评测。

配套技术文章：[《用 Node.js BFF 搭建 RAG 知识库系统》](docs/article.md)
逐次变更详解（面向零基础读者）：[docs/changes.md](docs/changes.md)

## 功能特性

- **文档管理**：上传 PDF / Markdown，自动解析、分块（800 字 / 100 重叠）、向量化（text-embedding-v3, 1024 维）入库；admin 可删除文档
- **RAG 问答**：pgvector 余弦相似度 Top-K 检索，Qwen 流式生成，回答带 `[n]` 引用标注，前端可点击高亮来源片段
- **Agent 工具调用**：模型自主决定调用 `search_knowledge`（默认开启）/ `web_search`（Tavily，可选）；多轮工具调用编号连续、token 用量累计，最大轮数兜底防死循环
- **权限与审计**：scrypt 密码哈希 + JWT 登录；admin / demo 两种角色；上传、删除、审计查看仅 admin；全部敏感操作落审计日志
- **监控与降级**：pino 双通道日志（控制台 pretty + JSON 文件）；模型流式空闲超时与向量化超时均返回 504 友好提示；空知识库直接引导上传，不浪费模型调用
- **自动化评测**：promptfoo 30 题测试集（事实 / 超范围 / 对抗 / 模糊 四类），通过率 100%，幻觉风险 0/15，详见 [eval/report.md](eval/report.md)

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 18 + TypeScript + Vite 5 |
| BFF | Node.js + Express + tsx |
| 数据库 | PostgreSQL 16 + pgvector（Docker） |
| LLM | Qwen（DashScope OpenAI 兼容接口）：qwen-plus 对话 / text-embedding-v3 向量 |
| 鉴权 | jsonwebtoken + node:crypto scrypt |
| 日志 | pino + pino-pretty |
| 评测 | promptfoo + qwen-plus 判定 |

## 目录结构

```
├── server/                 # Express BFF（端口 3001）
│   ├── src/
│   │   ├── routes/         # health / auth / chat / upload / documents / audit
│   │   ├── services/       # agent 循环、工具、检索、嵌入、分块、SSE 流式
│   │   ├── middlewares/    # JWT 鉴权、RBAC、请求日志、错误处理
│   │   └── db/             # pg 连接、schema、向量检索 SQL
│   └── scripts/            # 生成测试用 PDF 脚本
├── web/                    # React 前端（端口 5173，/api 代理到 3001）
│   └── src/components/     # 对话 / 文档管理 / 审计日志三面板 + 登录页
├── eval/                   # promptfoo 评测：题目集、SSE provider、报告
└── docs/article.md         # 技术文章
```

## 快速开始

前置：Node.js ≥ 20、Docker、一个 [DashScope API Key](https://dashscope.console.aliyun.com/)（有免费额度）。

```bash
# 1. 启动 PostgreSQL + pgvector
docker run -d --name ai-kb-pg -p 5432:5432 \
  -e POSTGRES_USER=kba -e POSTGRES_PASSWORD=kba123456 \
  -e POSTGRES_DB=knowledge_base pgvector/pgvector:pg16

# 2. 配置后端
cd server
cp .env.example .env          # 填入 QWEN_API_KEY 和 JWT_SECRET（openssl rand -hex 32）
npm install

# 3. 启动后端（首次自动建表 + 建 pgvector 索引 + 种子账号）
npm run dev

# 4. 启动前端（新终端）
cd web && npm install && npm run dev
```

打开 http://localhost:5173 ，用 `admin / admin123`（管理员）或 `demo / demo123`（普通用户）登录。users 表为空时自动创建这两个种子账号。

上传几份文档后，在「对话」页即可提问，回答带 `[n]` 引用，点击引用可查看来源片段。

## 运行评测

```bash
cd eval
npm exec -- promptfoo@latest eval -c promptfooconfig.yaml -o results.json --no-cache --max-concurrency 2
node summarize.js            # 汇总指标，重写 report.md
```

评测需要一个可用的后端服务（登录 demo 账号走真实 SSE 链路）和 `QWEN_API_KEY`（LLM 判定用）。评测框架要求 Node.js ≥ 22.22。

最近一次结果（2026-10-10，30 题）：通过率 **100%**，引用率 83%，幻觉风险 **0/15**，平均延迟 4.7s / P95 9.2s，成本约 ¥0.06。详见 [eval/report.md](eval/report.md)。

## API 概览

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| GET | `/api/health` | 健康检查 | 公开 |
| POST | `/api/auth/login` | 登录，返回 JWT | 公开 |
| GET | `/api/auth/me` | 当前用户信息 | 登录 |
| POST | `/api/chat` | SSE 流式问答（delta / tool / sources / done / error） | 登录 |
| POST | `/api/upload` | 上传 PDF / Markdown 并入库 | 登录 |
| GET | `/api/documents` | 文档列表 | 登录 |
| DELETE | `/api/documents/:id` | 删除文档 | admin |
| GET | `/api/audit` | 审计日志 | admin |

## 环境变量

见 [server/.env.example](server/.env.example)。关键项：

- `QWEN_API_KEY`：DashScope Key，**必填**
- `JWT_SECRET`：**必填**，`openssl rand -hex 32` 生成
- `TAVILY_API_KEY`：可选，留空则 `web_search` 工具不注册
- `CHAT_TIMEOUT_MS` / `EMBEDDING_TIMEOUT_MS`：超时降级阈值
- `AGENT_MAX_TOOL_ROUNDS`：Agent 工具调用最大轮数

## 测试账号

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| admin | admin123 | 管理员（上传/删除/审计） |
| demo | demo123 | 普通用户（对话/查看文档） |
