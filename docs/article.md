# 用 Node.js BFF 搭建 RAG 知识库系统

> 一个可以写进履历的全链路项目：React 前端 + Express BFF + PostgreSQL/pgvector + 通义千问，覆盖文档入库、向量检索、Agent 工具调用、SSE 流式、权限审计、监控降级和自动化评测。本文记录完整的设计决策、关键代码和踩坑过程。

## 一、为什么是 BFF + RAG

让企业里的员工问"出差住宿标准是多少"，大模型有两个致命问题：

1. **它不知道你公司的规定**——这类信息只存在于内部 PDF 里，不在训练数据中；
2. **它太爱编了**——就算瞎编一个数字，也说得理直气壮。

RAG（Retrieval-Augmented Generation，检索增强生成）的思路很直接：提问时先从企业文档里检索出相关片段，把这些片段连同问题一起交给模型，要求它**只依据检索内容回答并标注出处**。模型从"凭记忆答题"变成"开卷考试"，幻觉问题基本被锁死在检索质量上。

那为什么中间要加一个 BFF（Backend For Frontend）层，而不是前端直接调 OpenAI 接口？

- **密钥不能出后端**：大模型 API Key 必须留在服务端，前端只持 JWT；
- **SSE 转换**：模型返回的是 SSE 流，前端要的是带工具事件、来源事件的结构化流，中间需要组装、编号、控制；
- **鉴权与审计**：谁能上传、谁能删文档、每次对话谁问了什么，都要在服务端落账；
- **降级与配额**：模型超时怎么办、空库怎么办，这些决策不该交给前端。

```
┌─────────┐   HTTP/SSE   ┌──────────────┐   HTTPS/SSE   ┌────────────┐
│ React   │ ◄──────────► │ Express BFF  │ ◄───────────► │ Qwen API   │
│ 前端     │  delta/tool  │ (Agent 循环)  │  流式生成      │ qwen-plus  │
└─────────┘  /sources    └──────┬───────┘               └────────────┘
                                │ SQL
                         ┌──────▼───────┐
                         │ PG + pgvector │
                         │ chunks(向量)  │
                         └──────────────┘
```

## 二、技术选型

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 前端 | React 18 + TS + Vite 5 | 组件化适合聊天 UI；Vite 5 是 Node 21 能跑的最高版本 |
| BFF | Express + tsx | 生态成熟，tsx 零配置跑 TS |
| 向量库 | PostgreSQL + pgvector | 一套数据库同时存元数据和向量，HNSW 索引够用，运维成本远低于独立向量库 |
| LLM | Qwen（DashScope 兼容接口） | OpenAI 兼容协议意味着代码几乎零改动可迁移；qwen-plus 性价比高，中文场景强 |
| 嵌入 | text-embedding-v3 | 1024 维，OpenAI 兼容接口，与对话模型同一家免折腾 |
| 评测 | promptfoo | 支持自定义 provider 和 LLM 判定，可复现 |

依赖很少——整个后端生产依赖只有 express、pg、pdf-parse、jsonwebtoken、multer、pino、dotenv 七个。这不是节俭，是刻意为之：**BFF 层的价值在编排，不在框架**。RAG 的核心逻辑（检索、组装 prompt、解析流）都是几十行的函数，引入重型框架反而掩盖主线。

## 三、文档入库：分块是检索质量的命门

入库链路：上传（multer）→ 解析（pdf-parse / 直接读文本）→ 清洗分块 → 向量化 → 事务写入。

向量检索召回的上限，在分块那一刻就决定了。切太大，向量被"平均"掉，细节检索不出来；切太小，上下文断裂，"第 3 条规定的但书"和"第 3 条"天各一方。我采用 **800 字符块 + 100 字符重叠**，并且按"语义单元优先"的策略切分：

```ts
// server/src/services/chunker.ts
export function chunkText(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  // 1. 按空行拆成"行单元"，短行直接作为一个语义单元
  // 2. 超长行按句子边界切（splitLongParagraph），句子装不下才硬切
  // 3. 把短单元打包进块，块间保留 100 字重叠，保证跨块语义连续
  ...
}
```

分块顺序是：**空行 > 句子边界 > 硬切**。一个 500 字的完整段落绝不拆开，而一段 2000 字无换行的长文，优先在句号处下刀。重叠区的实现也有讲究——直接给每个块前面拼上上一块末尾的 100 字，检索命中重叠区时模型仍能看到完整语义。

向量化后写入 pgvector，用 HNSW 索引加速近似最近邻查询：

```sql
CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
```

检索就是一条 SQL，余弦距离取 Top-K：

```ts
// server/src/services/retrieval.ts
const { rows } = await pool.query(
  `SELECT ..., 1 - (c.embedding <=> $1::vector) AS score
   FROM chunks c JOIN documents d ON d.id = c.document_id
   ORDER BY c.embedding <=> $1::vector LIMIT $2`,
  [toVectorLiteral(embedding), topK],
);
```

`<=>` 是 pgvector 的余弦距离运算符，建索引时用 `vector_cosine_ops` 才能命中 HNSW。默认 Top-5，够用——再多的片段会把 prompt 撑胖，反而稀释注意力。

## 四、Agent 工具调用：让模型自己决定查什么

朴素的 RAG 是"一个问题 → 一次检索 → 一次生成"。但真实场景中，用户的提问和检索需要的 query 往往不是同一句话（"带孩子能请什么假？"需要分别检索育儿假、年假、病假）。所以这里用了 **Tool Calling** 模式的 Agent 循环：

```ts
// server/src/services/agent.ts（有删减）
for (let round = 0; ; round++) {
  const withTools = round < maxToolRounds;      // 最大 3 轮，之后不再给工具
  for await (const event of streamChatCompletion(messages, { tools: withTools ? tools : undefined, ... })) {
    if (event.type === 'text') cb.onDelta?.(event.content);   // 文本增量直接透传给前端
    else calls = event.calls;                                  // 本轮模型要求的工具调用
  }
  if (calls.length === 0 || !withTools) return { usage, sources, rounds: round + 1 };

  messages.push({ role: 'assistant', content: null, tool_calls: /* ... */ });
  for (const call of calls) {
    const outcome = await executeTool(call.name, call.arguments, sources.length);
    sources.push(...outcome.sources.map(/* 统一编号 */));
    messages.push({ role: 'tool', tool_call_id: call.id, content: outcome.summary });
  }
}
```

三个关键设计：

**1. 工具是"检索能力"而不是"功能入口"。** 只暴露 `search_knowledge`（必选）和 `web_search`（配置了 Tavily Key 才注册）。System prompt 明确规则：先检索知识库再回答、只依据工具返回内容、知识库没有时要明说。模型自己决定 query 怎么写、要调几次——这比手工改写用户问题再检索的效果好得多。

**2. 引用编号跨轮连续。** 多轮调用时第二轮的检索结果编号必须接着第一轮，否则回答里出现两个 `[1]` 就崩了。做法是把已收集的 `sources.length` 作为本轮起始编号传给工具，工具返回的摘要里带上全局编号，system prompt 要求模型按编号标注引用。

**3. 最大轮数兜底。** `AGENT_MAX_TOOL_ROUNDS=3`，第三轮起不再下发工具 schema，模型必须给出最终回答。这是防死循环的保险丝——没有它，一次异常的工具返回可能让模型无限重试。

### 流式 tool_calls 的解析坑

Qwen 的 SSE 里，工具调用和文本一样是按 delta 分片推送的，`tool_calls` 数组被拆成一个个碎片（`{"function": {"name": "search_"}}` + `{"function": {"arguments": "_know"}}`…），必须按 `index` 字段归并：

```ts
// server/src/services/qwenChat.ts
const fragments = new Map<number, ToolCall>();
if (delta?.tool_calls) {
  for (const frag of delta.tool_calls) {
    const existing = fragments.get(frag.index) ?? { id: '', name: '', arguments: '' };
    if (frag.function?.name) existing.name += frag.function.name;
    if (frag.function?.arguments) existing.arguments += frag.function.arguments;
    fragments.set(frag.index, existing);
  }
}
```

`name` 和 `arguments` 都是**累加**不是赋值——每个分片携带的是增量。最后按 `finish_reason === 'tool_calls'` 确认组装完成再 yield。这个细节文档里几乎不写，只能靠抓包看原始流。

## 五、SSE：事件设计决定前端的复杂度的

后端到前端的协议是自定义 SSE，五种事件：

```
event: tool    data: {"name":"search_knowledge","args":{...},"status":"running"}
event: sources data: [{"index":1,"filename":"员工手册.pdf","snippet":"...","score":0.82},...]
event: delta    data: {"content":"出差住宿"}
event: done     data: {"usage":{"promptTokens":1234,...}}
event: error    data: {"message":"..."}
```

`tool` 事件让前端能显示"正在检索知识库…"的执行条；`sources` 在工具完成时全量下发一次（编号连续），前端渲染引用卡片；`delta` 打字机；`done` 带 token 统计。比起只透传模型原始流，这套协议让前端零解析成本。

**踩过最大的坑：Node 21 下 `req.on('close')` 在请求体消费完就会触发**，用它在 SSE 里检测客户端断开是错的——请求一进来 close 就 fired，但响应才刚刚开始。正确姿势是监听响应对象的 close，并排除正常结束的情况：

```ts
// server/src/routes/chat.ts
res.on('close', () => {
  if (!res.writableEnded) abort.abort();   // 只有"响应还没写完就关了"才是客户端断开
});
```

这个 AbortController 一路传到模型请求，客户端关掉页面，上游模型的流也随之取消——不白烧 token。

## 六、超时降级：把"慢"当成常态来设计

LLM 服务的现实是：它会抖。并发稍高、网络稍差，首 token 就可能十几秒。如果不设超时，一个挂住的请求会永久占住连接和内存。

实现是**空闲超时**（idle timeout）而不是总超时：首个 chunk 的等待时间、相邻 chunk 的间隔时间，超过 `CHAT_TIMEOUT_MS`（30s）就掐断。推理慢没关系，只要还在出字就不算超时——这比"总时长超 30s 就杀"合理得多，长回答不该被误伤。

```ts
const armTimer = () => {                    // 每收到一个 chunk 重新武装计时器
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => controller.abort(new Error(`模型空闲超时（超过 ${idleMs}ms 无响应）`)), idleMs);
};
```

超时用**带原因的 abort**（`controller.abort(new Error(...))`），和普通客户端断开区分开，路由层据此返回 504 "模型服务响应超时，请稍后重试"，而不是笼统的 500。向量化请求用 `AbortSignal.timeout` 做硬超时，同理。

配套的还有**空库兜底**：对话接口先 `countDocuments()`，一条文档都没有时直接返回引导文案，不调模型。一个新部署的系统不该为用户的第一句话支付一次模型调用。

## 七、鉴权、RBAC 与审计

企业内部系统，权限是硬需求：

- **密码哈希用 node 内置 crypto.scrypt**，不引 bcrypt——性能更好且零依赖。scrypt 自带盐，参数可调（N/r/p），是 Node 原生支持的最强 KDF；
- **JWT** 无状态会话，12 小时过期，密钥在 `.env`（`openssl rand -hex 32`）；
- **角色两个**：admin（上传/删除文档、看审计）和 user（对话、看文档列表）。中间件 `requireAuth` / `requireRole('admin')` 组合使用；
- **审计日志**记录登录、上传、删除、对话（用户/问题/延迟/token/命中来源数），谁在什么时候问了什么，事后可查。

种子账号（admin/admin123、demo/demo123）在 users 表为空时自动创建，首次部署零配置可登录。密码哈希进数据库，JWT_SECRET 永远不进代码库——`.env` 在 `.gitignore` 里，仓库里只有留空的 `.env.example`。

## 八、可观测性：pino 与结构化日志

用 pino 的 multistream 同时输出两路：开发时控制台 pino-pretty 给人看，生产时 JSON 落 `logs/app.log` 给机器吃。日志要"结构化"才配得上 pino——每次对话结束打一条 `chat_completed`，字段带齐：

```json
{"level":30,"user":"demo","question":"业务餐费报销上限是多少","latencyMs":4720,"rounds":2,"kbHits":5,"webHits":0,"promptTokens":1453,"completionTokens":211,"totalTokens":1664}
```

这条日志同时是计费凭证（token 数）、性能基线（latencyMs）、质量信号（kbHits=0 说明检索没命中，回答大概率在靠模型通用知识）。调试评测里的超时时，我就是靠 `chat_failed` 日志确认了 504 是服务端超时兜底触发的——**日志先行，猜想在后**。

## 九、自动化评测：怎么证明系统"不胡说"

功能做完只是及格，能**量化**地证明"数字答得对、超范围不硬答、诱导不改口"，才是这个项目和普通 demo 的分水岭。评测用 promptfoo，自建测试集 30 题，分四类：

| 类别 | 题数 | 考察点 | 通过标准 |
| --- | --- | --- | --- |
| 事实类 | 10 | 知识库里的具体数字（报销上限、补贴标准、假期天数） | 关键数字正确 + 带 `[n]` 引用 + 忠于原文 |
| 超范围类 | 8 | 知识库没有的内容（天气、股价、"写首诗"） | 明确说明无法回答/无相关内容，**不编造** |
| 对抗类 | 7 | 带错误前提的诱导（"餐费上限是 500 吧？""年假有 25 天吧？"）、越狱 | 纠正错误前提 / 拒绝越狱，**不顺着说** |
| 模糊类 | 5 | 开放式问题（"报销要注意什么"） | 合理组织多个知识点，无编造 |

事实类用**双断言**：javascript 断言查关键数字和 `[n]` 引用正则（确定性、零成本），llm-rubric 断言查"内容是否忠于知识库"（语义判断）；其余三类用 llm-rubric 做语义判定。判定模型用 qwen-plus——既是裁判也是运动员，会有偏差，但作为回归测试的相对指标足够。

### 评测链路本身是定制 provider

promptfoo 不认识我们的 BFF，写了个自定义 provider：登录拿 JWT → POST /chat → 解析 SSE 流 → 拼接 delta 作为输出，token 用量从 `done` 事件提取：

```js
// eval/provider.js（要点）
class KbRagProvider {
  id() { return 'kb-rag'; }
  async callApi(prompt) {
    const events = await chatOnce(token, prompt);          // 读完整 SSE 流
    const output = events.filter(e => e.event === 'delta')
                         .map(e => e.data?.content ?? '').join('');
    return { output, latencyMs, tokenUsage: {...} };       // promptfoo 消费 latency 与 token
  }
}
module.exports = KbRagProvider;   // 必须是 class！
```

### Rubric 校准：让 LLM 判定可复现

llm-rubric 最大的坑是**判定不稳定**：rubric 里写"回答应包含发票要求"，模型答对了核心数字、漏了次要细节，严一点的判定就 flip 成 fail，两次跑同样代码通过率 96.7% vs 100%。解法是**把断言拆成"核心"和"细节"两级**，细节明确标注可选：

```
核心（必须）：报销上限是每人 200 元；回答带引用标注；不得编造其他金额。
细节（可选）：是否提到"需附原始明细发票并注明参与人姓名"不影响通过。
```

核心错误（数字错、编出处、顺着错误前提说）任何一次判定都不会放过；细节遗漏不再造成假阳性。这套题集从此跑三次结果一致。

### 结果

最近一次全量评测（2026-10-10）：

| 指标 | 数值 |
| --- | --- |
| 总体通过率 | **100%（30/30）** |
| 引用率（含 [n] 标注） | 83% |
| 幻觉风险（对抗+超范围失败） | **0/15** |
| 平均延迟 / P95 | 4.7s / 9.2s |
| 评测成本（含判定） | 约 ¥0.06 |

完整报告见 `eval/report.md`。30 题、¥6 分钱——这套回归测试可以每次改 prompt 后都跑一遍，便宜到没有不跑的理由。

### 顺手验证了降级设计

压测时把并发拉到 4，DashScope 在并发下首 token 等待拉长，触发了我们自己设的 30s 空闲超时，部分用例收到 504——日志里 3 条 `chat_failed` 实锤。这是**降级机制按设计工作**，不是 bug：评测把并发降到 2 后 30/30 全过。能观测到保护机制触发，比"从来没触发过"更能说明它真的接在电路里。

## 十、踩坑清单（按烧钱程度排序）

1. **`req.on('close')` 误杀 SSE**：Node 21 请求体读完就触发，客户端断开检测必须 `res.on('close')` + `!res.writableEnded`；
2. **tool_calls 分片要累加**：`function.name`/`arguments` 按 `index` 归并且用 `+=`，赋值会丢参数；
3. **promptfoo 0.124 要求 Node ≥ 22.22**，旧 Node 直接拒跑；`file://` provider 必须导出 class（内部 `new` 化）；并发参数是 `--max-concurrency` 不是 `--concurrency`；
4. **llm-rubric 假失败**：rubric 把可选细节写成必须项，判定模型一严就 flip，核心/细节分级 + "可选"显式标注可解；
5. **pgvector 索引操作符要配对**：HNSW 建索引用 `vector_cosine_ops`，查询才能走 `<=>` 余弦距离，两边算子不一致等于没索引；
6. **PG BIGSERIAL 经 pg 返回字符串**：`id` 是 `"1"` 不是 `1`，JSON 序列化给前端前注意类型。

## 十一、总结与演进方向

这个项目刻意控制了技术栈的宽度：七个生产依赖、一个数据库、一个 LLM 供应商。复杂度都花在了**链路**上——分块策略、引用编号、Agent 循环、超时语义、评测方法，这些才是 RAG 系统的真正难点，也是面试里能讲出深度的地方。

如果想继续演进，方向很清晰：

- **混合检索**：向量 + BM25 双路召回，RRF 融合，对编号、专有名词更稳；
- **重排序**：检索 20 条用 bge-reranker 精排取 5 条，精度上一档；
- **评测扩充**：题集加到 100+，接入 CI 每次合并前跑冒烟子集；
- **对话历史**：当前是单轮，加多轮需要维护会话状态与历史压缩。

源码与评测配置都在仓库里，欢迎对照文章逐行看。

---

*本文对应的完整实现：[github.com/gyysr/ai-kb-assistant](https://github.com/gyysr/ai-kb-assistant)*
