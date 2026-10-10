import { useEffect, useRef, useState } from 'react';
import { streamChat } from '../api';
import ChatMessage from './ChatMessage';
import type { ChatMessage as Message } from '../types';

const EXAMPLES = ['差旅费报销的每日限额是多少？', '员工每年有多少天年假？', '远程办公有哪些规定？'];

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const patchLast = (patch: Partial<Message>) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, ...patch };
      return next;
    });
  };

  const upsertTool = (
    name: string,
    args: Record<string, unknown>,
    status: 'running' | 'done',
  ) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = next[next.length - 1];
      const tools = [...(last.tools ?? [])];
      if (status === 'running') {
        tools.push({ name, args, status });
      } else {
        const idx = tools.map((t) => t.status).lastIndexOf('running');
        if (idx >= 0) tools[idx] = { ...tools[idx], status: 'done' };
        else tools.push({ name, args, status });
      }
      next[next.length - 1] = { ...last, tools };
      return next;
    });
  };

  const send = async (question?: string) => {
    const q = (question ?? input).trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: q },
      { role: 'assistant', content: '', streaming: true },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    let finished = false;

    try {
      await streamChat(
        q,
        {
          onSources: (sources) => patchLast({ sources }),
          onTool: upsertTool,
          onDelta: (content) =>
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, content: last.content + content };
              return next;
            }),
          onDone: (usage) => {
            finished = true;
            patchLast({ usage, streaming: false });
          },
          onError: (message) => {
            finished = true;
            patchLast({ error: message, streaming: false });
          },
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        patchLast({ error: '网络异常，请稍后重试', streaming: false });
      }
    } finally {
      if (!finished) patchLast({ streaming: false });
      setBusy(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <>
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="empty">
            <h2>上传文档，开始提问</h2>
            <p>回答基于知识库中的文档内容，并附带引用来源。</p>
            <div className="examples">
              {EXAMPLES.map((q) => (
                <button key={q} className="example" onClick={() => void send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="msg-list">
            {messages.map((m, i) => (
              <ChatMessage key={i} message={m} />
            ))}
          </div>
        )}
      </div>

      <footer className="composer">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        {busy ? (
          <button className="btn btn-stop" onClick={stop}>
            停止
          </button>
        ) : (
          <button className="btn" onClick={() => void send()} disabled={!input.trim()}>
            发送
          </button>
        )}
      </footer>
    </>
  );
}
