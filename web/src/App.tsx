import { useEffect, useState } from 'react';
import { logout } from './api';
import { clearAuth, loadAuth, saveAuth, UNAUTHORIZED_EVENT } from './auth';
import AuditPanel from './components/AuditPanel';
import ChatPanel from './components/ChatPanel';
import DocPanel from './components/DocPanel';
import LoginView from './components/LoginView';
import type { AuthState } from './types';

type Tab = 'chat' | 'docs' | 'audit';

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(() => loadAuth());
  const [tab, setTab] = useState<Tab>('chat');

  useEffect(() => {
    const onExpired = () => setAuth(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onExpired);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onExpired);
  }, []);

  if (!auth) {
    return (
      <LoginView
        onLogin={(state) => {
          saveAuth(state);
          setAuth(state);
          setTab('chat');
        }}
      />
    );
  }

  const isAdmin = auth.user.role === 'admin';

  const handleLogout = async () => {
    await logout();
    clearAuth();
    setAuth(null);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="header-title">
            <span className="logo">KB</span>
            <div>
              <h1>AI 知识库问答助手</h1>
              <p>基于 RAG 的文档问答 · Qwen + pgvector</p>
            </div>
          </div>
          <nav className="tabs">
            <button className={`tab${tab === 'chat' ? ' active' : ''}`} onClick={() => setTab('chat')}>
              对话
            </button>
            <button className={`tab${tab === 'docs' ? ' active' : ''}`} onClick={() => setTab('docs')}>
              文档管理
            </button>
            {isAdmin && (
              <button className={`tab${tab === 'audit' ? ' active' : ''}`} onClick={() => setTab('audit')}>
                审计日志
              </button>
            )}
          </nav>
        </div>
        <div className="user-box">
          <span className="user-name">{auth.user.username}</span>
          <span className={`role-badge role-${auth.user.role}`}>
            {isAdmin ? '管理员' : '普通用户'}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => void handleLogout()}>
            退出
          </button>
        </div>
      </header>

      {/* 始终挂载、用 hidden 隐藏：切 tab 不丢对话状态，进行中的流也不会被卸载打断 */}
      <div className="panel-host" hidden={tab !== 'chat'}>
        <ChatPanel />
      </div>
      <div className="panel-host" hidden={tab !== 'docs'}>
        <DocPanel user={auth.user} />
      </div>
      {isAdmin && (
        <div className="panel-host" hidden={tab !== 'audit'}>
          <AuditPanel />
        </div>
      )}
    </div>
  );
}
