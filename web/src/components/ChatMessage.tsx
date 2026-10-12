import { lazy, Suspense, useRef, type ReactNode } from 'react';
import type { ChatMessage as Message } from '../types';

// echarts 体积大（~560KB），按需分包：出现图表块时才加载
const EChartBlock = lazy(() => import('./EChartBlock'));

function renderInline(text: string, onCitation?: (n: number) => void): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*)|(`[^`\n]+`)|\[(\d+)\]/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) {
      parts.push(<strong key={key++}>{m[1].slice(2, -2)}</strong>);
    } else if (m[2]) {
      parts.push(<code key={key++} className="md-inline-code">{m[2].slice(1, -1)}</code>);
    } else if (m[3]) {
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
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// GFM 表格分隔行：|---|:--:| 这类，每个单元格只允许 - : 空白
function isTableSeparator(line: string): boolean {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  return cells.length > 0 && cells.every((c) => /^[\s:]*-[\s:-]*$/.test(c));
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function renderContent(content: string, onCitation?: (n: number) => void): ReactNode {
  const blocks: ReactNode[] = [];
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

    // 代码块：流式中途未闭合时按已收到内容渲染
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

    // 表格：当前行含 | 且下一行是分隔行才成表，否则按普通段落（避免流式半截表格乱闪）
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      flushList();
      const header = splitTableRow(trimmed);
      const rows: string[][] = [];
      i += 2;
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
    blocks.push(<p key={key++}>{renderInline(trimmed, onCitation)}</p>);
    i++;
  }
  flushList();
  return blocks;
}

function scorePercent(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

function toolLabel(name: string, args: Record<string, unknown>): string {
  const query = typeof args.query === 'string' ? args.query : '';
  if (name === 'search_knowledge') return `检索知识库：${query}`;
  if (name === 'web_search') return `联网搜索：${query}`;
  return `${name}：${query || JSON.stringify(args)}`;
}

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

export default function ChatMessage({ message }: { message: Message }) {
  const containerRef = useRef<HTMLDivElement>(null);

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
