# web/ —— React 前端（单页应用）

这个文件夹是整个项目的"脸"：用 **React 18 + TypeScript + Vite 5** 写的单页应用（SPA）。开发模式跑在 **5173** 端口，`/api` 请求自动代理到后端 3001。

## 它在整个系统里的位置

```
┌───────────────  web/（本文件夹） ───────────────┐
│  登录页 → 主界面（对话 / 文档管理 / 审计日志）   │
│                                                 │
│  api.ts：唯一跟后端说话的地方（HTTP + SSE）      │
└────────────────────┬────────────────────────────┘
                     │ HTTP（普通接口）/ SSE（流式聊天）
                     ▼
              server/（Express BFF，端口 3001）
```

> **SPA 是什么？** Single Page Application 单页应用——浏览器只加载一次 HTML，之后切换"页面"全靠 JavaScript 改 DOM，不再整页刷新。好处是聊天流、输入框焦点这些状态在切换时不会丢。

## 目录结构（每个文件干什么）

```
web/
├── index.html            # 唯一的 HTML 页面（SPA 的"壳"，Vite 的入口）
├── vite.config.ts        # Vite 配置：5173 端口 + /api 代理到 localhost:3001
├── src/
│   ├── main.tsx          # React 挂载入口：把 App 组件渲染进 index.html 的根节点
│   ├── App.tsx           # 应用外壳：登录门卫 + 顶栏（tab/额度徽标/用户区）+ 三面板调度
│   ├── api.ts            # ★ 后端接口封装：普通请求（request）+ SSE 流式（streamChat）
│   ├── auth.ts           # token 存取（localStorage）+ "未授权"事件广播
│   ├── types.ts          # 数据类型"图纸"：跟后端返回的字段一一对应
│   ├── index.css         # 全部样式（暗色主题，含消息气泡/表格/图表/徽标样式）
│   ├── vite-env.d.ts     # Vite 环境类型声明
│   └── components/       # ★ 界面组件
│       ├── LoginView.tsx     # 登录/注册页（没登录时整个应用只显示它）
│       ├── ChatPanel.tsx     # 对话面板：消息列表、输入框、发送/停止、示例问题
│       ├── ChatMessage.tsx   # 单条消息渲染：自写迷你 Markdown 解析器（表格/代码块/引用标注）
│       ├── EChartBlock.tsx   # 图表块：```echarts JSON → ECharts 交互图表（懒加载分包）
│       ├── DocPanel.tsx      # 文档管理：上传、列表、删除（admin）
│       └── AuditPanel.tsx    # 审计日志表格（admin）
```

## 三个值得了解的设计

### 1. 流式聊天的前端消费（api.ts → ChatPanel.tsx）

后端通过 SSE 一帧一帧推数据（`sources`/`tool`/`delta`/`done`/`error` 五种事件）。`api.ts` 的 `streamChat` 用 `ReadableStream` 逐块读取、按空行切帧；`ChatPanel.tsx` 收到 `delta` 就往最后一条占位消息追加文字——打字机效果就是这么来的。"停止"按钮靠 `AbortController`：一按，正在等的 `fetch` 立刻断流。

### 2. 切 tab 不丢对话（App.tsx）

三个面板**始终挂载**、只是用 HTML `hidden` 属性轮流显示。如果按常规做法"切走就卸载"，进行到一半的流式回答会被掐断、消息列表清空。

### 3. 图表按需加载（EChartBlock.tsx）

ECharts 库有 560KB。用 `React.lazy` 把图表组件拆成独立 chunk，主包只有 161KB——只有当回答里真出现 ```echarts 图表块时才下载。

## Markdown 渲染

模型输出的 Markdown（表格、代码块、加粗、`[n]` 引用标注）由 `ChatMessage.tsx` 自写的迷你解析器渲染，没引入现成库，原因是流式场景需要"半截内容不乱闪"：

- 表格只在"表头行 + 分隔行"都到齐后才渲染（流式半截表格先当普通段落）
- 未闭合的代码块按已收到的内容渲染，echarts JSON 未闭合时显示"图表生成中"
- `[n]` 引用渲染成可点击上标，点击滚动并闪烁对应来源卡

## 本地开发

```bash
cd web
npm install
npm run dev        # http://localhost:5173（先启动 server，/api 才有响应）
```

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（热更新，`/api` 代理到 3001） |
| `npm run typecheck` | 只查类型错误 |
| `npm run build` | 构建产出 `dist/`（生产用） |
| `npm run preview` | 本地预览构建产物 |

## 构建与路径前缀（`/kb/`）

生产环境前端挂在 nginx 的 `/kb/` 路径下（同台服务器还跑着另一个项目占着根路径），所以 Docker 构建时执行 `npm run build -- --base=/kb/`，产物里的资源引用都带 `/kb/` 前缀。`api.ts` 用 `import.meta.env.BASE_URL` 拼 API 地址，同一份代码本地（`/api`）和线上（`/kb/api`）自动各归各位，不用手改。

登录账号：`admin/admin123`（管理员）、`demo/demo123`（普通用户）。token 存 localStorage，刷新不丢；任何接口返回 401 会广播事件，App 监听后自动跳回登录页。

## 延伸阅读

- 后端接口与 SSE 协议详情：[server/README.md](../server/README.md)
- 全项目变更详解（小白向）：[docs/changes.md](../docs/changes.md)
