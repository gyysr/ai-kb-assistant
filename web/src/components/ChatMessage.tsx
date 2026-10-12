import { lazy, Suspense, useRef, type ReactNode } from 'react';
import type { ChatMessage as Message } from '../types';

// echarts 体积大（~560KB），按需分包：出现图表块时才加载
const EChartBlock = lazy(() => import('./EChartBlock'));

// 行内格式解析：把一行文字里的 **加粗**、`行内代码`、[1] 引用标 挑出来换成
// 对应的 HTML 元素，中间夹着的普通文字原样保留。
// 实现思路就是一个正则 + while 循环（exec 会记住上次位置，逐个匹配下去），
// 每命中一处就把"上一处到这一处之间的普通文字"先推入结果数组
function renderInline(text: string, onCitation?: (n: number) => void): ReactNode[] {
  const parts: ReactNode[] = [];
  // 三个分组依次对应：加粗 / 行内代码 / [数字] 引用
  const regex = /(\*\*[^*]+\*\*)|(`[^`\n]+`)|\[(\d+)\]/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(text)) !== null) {
    // 匹配到的片段前面的普通文字也要保留
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) {
      // slice(2, -2) 剥掉两端的 ** 星号
      parts.push(<strong key={key++}>{m[1].slice(2, -2)}</strong>);
    } else if (m[2]) {
      parts.push(<code key={key++} className="md-inline-code">{m[2].slice(1, -1)}</code>);
    } else if (m[3]) {
      // [n] 引用标注：渲染成可点击的上标，点了滚动+闪烁对应来源卡片
      const n = Number(m[3]);
      parts.push(
        <sup
          key={key++}
          className="citation"
          role="button"
          title={`查看来源 ${n}`}
          onClick={() => onCitation?.(n)}
        >
          [{n}]
        </sup>,
      );
    }
    last = m.index + m[0].length;
  }
  // 尾部剩余的普通文字
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// GFM 表格分隔行：|---|:--:| 这类，每个单元格只允许 - : 空白
function isTableSeparator(line: string): boolean {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  return cells.length > 0 && cells.every((c) => /^[\s:]*-[\s:-]*$/.test(c));
}

// 把 "| a | b |" 拆成 ['a','b']：掐头去尾的竖线再按 | 切
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

// ===== 迷你 Markdown 解析器（块级） =====
// 没引入 react-markdown 等库，是因为流式场景需要"半截内容也要能渲染不乱闪"，
// 自己写 200 行反而可控。解析策略：逐行扫描（while + 手动推进 i），
// 因为表格/代码块这类结构一次要"吃掉"多行，for 循环做不到往前跳
function renderContent(content: string, onCitation?: (n: number) => void): ReactNode {
  const blocks: ReactNode[] = [];
  // 列表项攒在一起：连续的 "- xxx" 行归入同一个 <ul>，遇到别的行先结算（flush）
  let listItems: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    blocks.push(
      <ul key={key++}>
        {items.map((item, i) => (
          <li key={i}>{renderInline(item, onCitation)}</li>
        ))}
      </ul>,
    );
  };

  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // 代码块：```语言 开头，到下一个 ``` 结束。
    // 流式时收尾围栏还没到 —— 照样把已收到的行渲染出来（closed=false），
    // 免得界面闪一块忽有忽无的空白
    const fence = /^```(\S*)\s*$/.exec(trimmed);
    if (fence) {
      flushList();
      const lang = fence[1];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      const closed = i < lines.length; // 是否找到收尾围栏
      i++; // 跳过收尾 ```（未闭合时自然越界，无碍）
      const codeText = codeLines.join('\n');
      if (lang === 'echarts') {
        // echarts 围栏交给 EChartBlock：内含 JSON option，渲染成交互图表。
        // Suspense + lazy —— 560KB 的 echarts 只在真有图表时才下载
        blocks.push(
          <Suspense
            key={key++}
            fallback={<div className="md-chart md-chart-pending">图表组件加载中…</div>}
          >
            <EChartBlock raw={codeText} closed={closed} />
          </Suspense>,
        );
      } else {
        blocks.push(
          <div key={key++} className="md-code">
            {lang && <div className="md-code-lang">{lang}</div>}
            <pre>
              <code>{codeText}</code>
            </pre>
          </div>,
        );
      }
      continue;
    }

    // 表格：当前行含 | 且下一行是 |---| 分隔行才成表，否则当普通段落 ——
    // 流式时经常只收到半行 "| 项目 | 金额"（分隔行还没到），
    // 若急着渲染表格，会闪一个畸形表格出来再消失，体验很差
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      flushList();
      const header = splitTableRow(trimmed);
      const rows: string[][] = [];
      i += 2; // 跳过表头行和分隔行
      // 连续的非空含 | 行都是数据行
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        lines[i].trim().includes('|')
      ) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push(
        <table key={key++} className="md-table">
          <thead>
            <tr>
              {header.map((cell, c) => (
                <th key={c}>{renderInline(cell, onCitation)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>{renderInline(cell, onCitation)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    // "- / *" 开头的行攒进列表缓冲，等 flushList 一次性输出 <ul>
    if (/^[-*]\s+/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*]\s+/, ''));
      i++;
      continue;
    }
    flushList();
    if (trimmed === '') {
      i++;
      continue;
    }
    // # 标题（简化处理：统一渲染成加大的段落样式）
    const heading = /^#{1,4}\s+(.*)/.exec(trimmed);
    if (heading) {
      blocks.push(
        <p key={key++} className="md-heading">
          {renderInline(heading[1], onCitation)}
        </p>,
      );
      i++;
      continue;
    }
    // 兜底：普通段落
    blocks.push(<p key={key++}>{renderInline(trimmed, onCitation)}</p>);
    i++;
  }
  flushList();
  return blocks;
}

function scorePercent(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

// 工具卡上显示的友好文案：把工具名 + 参数翻译成人话
function toolLabel(name: string, args: Record<string, unknown>): string {
  const query = typeof args.query === 'string' ? args.query : '';
  if (name === 'search_knowledge') return `检索知识库：${query}`;
  if (name === 'web_search') return `联网搜索：${query}`;
  return `${name}：${query || JSON.stringify(args)}`;
}

// 工具调用步骤条：模型用了哪些工具、各自跑完没有，一行一个"chip"
function ToolSteps({ tools }: { tools: Message['tools'] }) {
  if (!tools || tools.length === 0) return null;
  return (
    <div className="tools">
      {tools.map((t, i) => (
        <div key={i} className={`tool-chip ${t.status}`}>
          <span className="tool-badge">{t.name === 'web_search' ? 'WEB' : 'KB'}</span>
          <span className="tool-name">{toolLabel(t.name, t.args)}</span>
          {t.status === 'running' ? (
            <span className="tool-spinner" aria-label="执行中" />
          ) : (
            <span className="tool-check">✓</span>
          )}
        </div>
      ))}
    </div>
  );
}

// 参考来源卡片列表：知识库片段（可点击引用定位）+ 联网搜索结果（可点链接）
function SourceList({ sources }: { sources: Message['sources'] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="sources">
      <div className="sources-title">参考来源（{sources.length} 条）</div>
      {sources.map((s) => (
        <div key={s.index} className="source-card" data-source={s.index}>
          <div className="source-head">
            <span className="source-badge">{s.index}</span>
            {s.kind === 'web' && s.url ? (
              <a
                className="source-file source-link"
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {s.filename}
              </a>
            ) : (
              <span className="source-file">{s.filename}</span>
            )}
            {s.chunkIndex !== undefined && <span className="source-chunk">第 {s.chunkIndex + 1} 段</span>}
            <span className="source-score">
              <span className="score-bar">
                <span className="score-fill" style={{ width: `${scorePercent(s.score)}%` }} />
              </span>
              {(s.score * 100).toFixed(1)}%
            </span>
          </div>
          <div className="source-snippet">{s.snippet}</div>
        </div>
      ))}
    </div>
  );
}

// 单条消息的渲染入口。用户消息纯文本直出；
// assistant 消息 = 工具步骤条 + 正文（markdown）+ 来源卡 + token 用量
export default function ChatMessage({ message }: { message: Message }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击 [n] 引用标注：滚动到第 n 条来源卡并让它闪一下。
  // void el.offsetWidth 是个小黑科技 —— 读取这个属性会强制浏览器立即重排，
  // 从而"打断"上一次的动画，让同一张卡能连续触发两次闪烁
  const handleCitation = (n: number) => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-source="${n}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  };

  if (message.role === 'user') {
    return (
      <div className="msg msg-user">
        <div className="bubble bubble-user">{message.content}</div>
      </div>
    );
  }

  return (
    <div className="msg msg-assistant" ref={containerRef}>
      <div className="avatar">AI</div>
      <div className="assistant-body">
        <ToolSteps tools={message.tools} />
        {message.error ? (
          <div className="bubble bubble-error">{message.error}</div>
        ) : (
          <div className="bubble bubble-assistant">
            {message.content
              ? renderContent(message.content, handleCitation)
              : message.streaming && <span className="thinking">检索知识库中…</span>}
            {message.streaming && message.content && <span className="caret" />}
          </div>
        )}
        <SourceList sources={message.sources} />
        {message.usage && !message.streaming && (
          <div className="meta">
            tokens: {message.usage.promptTokens} → {message.usage.completionTokens}
          </div>
        )}
      </div>
    </div>
  );
}
