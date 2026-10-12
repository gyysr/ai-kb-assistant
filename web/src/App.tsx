import { useCallback, useEffect, useState } from 'react';
import { getUsage, logout } from './api';
import { clearAuth, loadAuth, saveAuth, UNAUTHORIZED_EVENT } from './auth';
import AuditPanel from './components/AuditPanel';
import ChatPanel from './components/ChatPanel';
import DocPanel from './components/DocPanel';
import LoginView from './components/LoginView';
import type { AuthState, UsageSummary } from './types';

type Tab = 'chat' | 'docs' | 'audit';

// 联网搜索额度徽标的配色档位：正常 / 已用 ≥90%（黄） / 用尽（红）
function quotaLevel(q: UsageSummary['webSearch']): string {
  const { used = 0, limit } = q;
  if (limit == null || limit <= 0) return '';
  const ratio = used / limit;
  if (ratio >= 1) return 'quota-out';
  if (ratio >= 0.9) return 'quota-warn';
  return 'quota-ok';
}

// 应用外壳：登录门卫 + 顶部栏（tab 导航、用户区）+ 三个功能面板
export default function App() {
  // 登录态。初始值用函数形式 loadAuth()：只从 localStorage 读一次，
  // 避免"每次组件重渲染都读一遍磁盘"
  const [auth, setAuth] = useState<AuthState | null>(() => loadAuth());
  const [tab, setTab] = useState<Tab>('chat');
  // Tavily 联网搜索的剩余额度（顶部徽标数据）
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  // 手动刷新额度：徽标点击时也调它。useCallback 包一层保证引用稳定，
  // 否则下面的 useEffect 依赖数组每轮都变，会无限请求
  const refreshUsage = useCallback(() => {
    getUsage()
      .then(setUsage)
      .catch(() => setUsage(null));
  }, []);

  // 监听"未授权"广播：任何接口返回 401 时 api.ts 会派发这个事件，
  // 这里统一响应 —— 把登录态清空，界面自动切回登录页
  useEffect(() => {
    const onExpired = () => setAuth(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onExpired);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onExpired);
  }, []);

  // 登录态变化时拉取/清空额度数据
  useEffect(() => {
    if (auth) refreshUsage();
    else setUsage(null);
  }, [auth, refreshUsage]);

  // 未登录只渲染登录视图（后面的主界面整体不出现）
  if (!auth) {
    return (
      <LoginView
        onLogin={(state) => {
          // 登录成功：token 落盘（刷新页面也不丢）+ 更新内存态 + 回到对话 tab
          saveAuth(state);
          setAuth(state);
          setTab('chat');
        }}
      />
    );
  }

  // 审计日志 tab 只有 admin 可见 —— 权限在前端的一层体现
  //（真正的拦截在服务器，前端隐藏只是体验优化，绕过前端也拿不到数据）
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
          {/* 联网搜索额度徽标：只在后端配了 Tavily Key（enabled）且拿到额度时显示；
              显示"剩余/总额度"，点击手动刷新（后端有 60 秒缓存，狂点也没用） */}
          {usage?.webSearch.enabled && usage.webSearch.limit != null && (
            <button
              type="button"
              className={`quota-badge ${quotaLevel(usage.webSearch)}`}
              title={`Tavily ${usage.webSearch.plan ?? ''} 计划 · 已用 ${usage.webSearch.used ?? 0} 次，点击刷新`}
              onClick={refreshUsage}
            >
              联网搜索 {Math.max(0, usage.webSearch.limit - (usage.webSearch.used ?? 0))}/
              {usage.webSearch.limit}
            </button>
          )}
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
