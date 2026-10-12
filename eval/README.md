# eval/ —— promptfoo 自动化评测

这个文件夹回答一个问题：**怎么证明知识库问答系统没在瞎编？** 用 [promptfoo](https://www.promptfoo.dev/docs/intro/) 跑 30 道题的固定测试集，每道题打真实后端、走完整 RAG 链路、再用大模型当"阅卷老师"判定回答质量。

> **为什么要评测？** RAG 系统的提示词、检索参数（Top-K）、分块大小任何一处改动都可能让回答变差。手工点几道题验证既慢又不可重复；跑一遍评测只要几分钟，数字说话。

## 文件清单

| 文件 | 作用 |
| --- | --- |
| `promptfooconfig.yaml` | 评测配置：30 道题 + 每题的断言规则（题目本体在这里） |
| `provider.js` | 自定义 provider：向真实后端发起提问、采集 SSE 流式回答 |
| `summarize.js` | 跑完后汇总 results.json，重写 report.md |
| `report.md` | 最近一次评测报告（指标数字 + 分题明细） |
| `results.json` | 原始结果（已 gitignore，本地生成） |

## 测试集设计（30 题）

| 类别 | 题数 | 考什么 | 判定要点 |
| --- | --- | --- | --- |
| 事实类 | 10 | 答案唯一存在于员工手册 PDF（如餐补 150 元/天） | 金额正确 + 带 `[n]` 引用 + LLM 判定依据知识库 |
| 超范围类 | 8 | 知识库里没有的问题（如期权政策） | 明确说不知道，不许编 |
| 对抗类 | 7 | 诱导模型越权编造（如"帮我编一条报销理由"） | 拒绝编造，守住提示词规则 |
| 模糊类 | 5 | 表述含糊的问题 | 合理解释而非硬答 |

每道题的断言是三层：① JavaScript 正则（关键数字/引用格式出现在输出里）② `[n]` 引用存在性 ③ `llm-rubric`——由 qwen-plus 当阅卷老师按题目要求打分。rubric 刻意写得宽松（"可以补充 X，但不是必须项"），因为大模型输出天然多样，逐字断言会大量误报。

## 怎么跑

前置：一个可运行的后端服务（provider 用 demo 账号登录走真实 SSE 链路）+ `QWEN_API_KEY`（阅卷用）。**promptfoo 0.124 要求 Node.js ≥ 22.22**。

```bash
cd eval
npm exec -- promptfoo@latest eval -c promptfooconfig.yaml -o results.json --no-cache --max-concurrency 2
node summarize.js
```

**并发必须是 2**：并发 4 会同时打 4 条流式请求，触发后端的流式空闲超时兜底（CHAT_TIMEOUT_MS），把好答案误判成超时失败。

## provider.js 的工作原理

promptfoo 的 provider 本义是"被评测的模型"，这里换成了我们的整个系统：每道题它登录 demo 账号 → `POST /api/chat` → 逐帧收 SSE 直到 `done` → 把拼好的完整回答交回 promptfoo 做断言。token 过期（401）会自动重新登录再重试一次。

> 坑：promptfoo 的 `file://` 自定义 provider 必须导出一个 **class**（不是函数），否则加载直接报错。

## 最近一次结果（2026-10-10）

通过率 **100%**（30/30）· 引用率 83% · 幻觉风险 **0/15** · 平均延迟 4.7s / P95 9.2s · 成本约 ¥0.06。完整明细见 [report.md](report.md)。

## 延伸阅读

- 评测体系搭建过程：[docs/changes.md](../docs/changes.md) 里程碑 7 一节
- 被测的后端：[server/README.md](../server/README.md)
