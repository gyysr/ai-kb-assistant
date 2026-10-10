import { useRef, type ReactNode } from 'react';
import type { ChatMessage as Message } from '../types';

function renderInline(text: string, onCitation?: (n: number) => void): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*)|\[(\d+)\]/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) {
      parts.push(<strong key={key++}>{m[1].slice(2, -2)}</strong>);
    } else if (m[2]) {
      const n = Number(m[2]);
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

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (/^[-*]\s+/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*]\s+/, ''));
      continue;
    }
    flushList();
    if (trimmed === '') continue;
    const heading = /^#{1,4}\s+(.*)/.exec(trimmed);
    if (heading) {
      blocks.push(
        <p key={key++} className="md-heading">
          {renderInline(heading[1], onCitation)}
        </p>,
      );
      continue;
    }
    blocks.push(<p key={key++}>{renderInline(trimmed, onCitation)}</p>);
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
