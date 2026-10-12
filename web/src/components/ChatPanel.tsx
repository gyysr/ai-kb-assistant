import { useEffect, useRef, useState } from 'react';
import { streamChat } from '../api';
import ChatMessage from './ChatMessage';
import type { ChatMessage as Message } from '../types';

// 空状态展示的三个示例问题，点击直接发送，帮新用户理解"能问什么"
const EXAMPLES = ['差旅费报销的每日限额是多少？', '员工每年有多少天年假？', '远程办公有哪些规定？'];

// 聊天主面板：消息列表 + 输入框 + 发送/停止逻辑。
// 一条回答的完整旅程：用户输入 → send() 发起流式请求 → SSE 回调不断更新
// 最后那条 assistant 占位消息（来源、工具卡、文字一点点长出来）→ done 后收尾
export default function ChatPanel() {
  // 消息列表。user 和 assistant 消息按顺序混在同一个数组里，渲染出来就是对话
  const [messages, setMessages] = useState<Message[]>([]);
  // 输入框内容（受控组件：textarea 显示的值永远来自这个 state）
  const [input, setInput] = useState('');
  // 是否正在回答中。true 时显示"停止"按钮、禁用发送
  const [busy, setBusy] = useState(false);
  // 当前流的"停止开关"。用 ref 不用 state：它不需要触发界面刷新，
  // 只要求任何时刻读到的都是最新值
  const abortRef = useRef<AbortController | null>(null);
  // 消息滚动容器，用于自动滚到底部
  const scrollRef = useRef<HTMLDivElement>(null);
  // 输入框 DOM，发送完自动把焦点还回去（省一次鼠标点击）
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 消息一有变化就滚到底部 —— 模型边答边滚，用户始终看到最新文字
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // 组件卸载（退出登录）时中止进行中的流，避免半条 SSE 留在后台
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // "新对话"按钮：停掉进行中的流、清空消息和输入框
  const newChat = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  };

  // 修改"最后一条消息"的辅助函数 —— 最后一条永远是正在流式输出的 assistant 占位。
  // SSE 的 sources/delta/tool/done 回调都要往它身上写数据，而 React 不允许直接改
  // state，必须"浅拷贝整个数组 → 拷贝目标对象 → 改副本 → set 回去"才能触发刷新。
  // patch 里只写要改的字段，其余字段保持原样（Partial 的含义）
  const patchLast = (patch: Partial<Message>) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, ...patch };
      return next;
    });
  };

  // 更新最后一条消息的工具调用列表。模型一次回答可能连续调好几个工具，
  // 前端按顺序记录：收到 status:'running' 就追加一张"运行中"工具卡，
  // 收到 'done' 就把最后一个"运行中"的翻成"完成" —— 界面上工具卡依次点亮
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

  // 发送一条消息。question 参数供"示例问题"按钮直接传文字进来
  const send = async (question?: string) => {
    const q = (question ?? input).trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);
    // 先"垫"两条消息进列表：用户的提问 + 一条空的 assistant 占位消息。
    // 之后所有 SSE 回调都往这条占位消息里填内容，打字机效果由此而来
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: q },
      { role: 'assistant', content: '', streaming: true },
    ]);

    // 每次发送都新建一个停止开关；旧的自然被覆盖（同一时刻只有一条流）
    const controller = new AbortController();
    abortRef.current = controller;
    // finished 标记 done/error 回调是否来过。finally 里据此决定要不要
    // 兜底复位转圈状态 —— 网络中途断掉时回调不会来，必须兜底
    let finished = false;

    try {
      await streamChat(
        q,
        {
          onSources: (sources) => patchLast({ sources }),
          onTool: upsertTool,
          // 每到一个字就往最后一条消息追加一个字
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
      // 用户点"停止"触发的 abort 是预期行为，不算错误，界面不显示提示
      if ((err as Error).name !== 'AbortError') {
        patchLast({ error: '网络异常，请稍后重试', streaming: false });
      }
    } finally {
      // 兜底：流断在半路（done/error 都没来）也要关掉转圈
      if (!finished) patchLast({ streaming: false });
      setBusy(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  };

  // 停止按钮：按下开关，fetch 立刻断流；界面上已收到的半截回答保留
  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  // 回车发送、Shift+回车换行。
  // isComposing 是中文输入法的坑：拼音候选框还开着时按回车是"上屏选字"，
  // 不判断的话字还没打完消息就被发出去了
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <>
      <div className="chat-toolbar">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={newChat}
          disabled={busy || (messages.length === 0 && !input.trim())}
        >
          ＋ 新对话
        </button>
      </div>
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
