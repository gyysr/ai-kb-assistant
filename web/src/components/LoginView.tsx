import { useState } from 'react';
import { login, register } from '../api';
import type { AuthState } from '../types';

export default function LoginView({ onLogin }: { onLogin: (state: AuthState) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const state =
        mode === 'login'
          ? await login(username.trim(), password)
          : await register(username.trim(), password);
      onLogin(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-head">
          <span className="logo">KB</span>
          <div>
            <h1>AI 知识库问答助手</h1>
            <p>基于 RAG 的文档问答 · Qwen + pgvector</p>
          </div>
        </div>

        <form onSubmit={submit}>
          <label className="field">
            <span>用户名</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="3-32 个字符"
              autoComplete="username"
              autoFocus
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
          </label>

          {error && <div className="login-error">{error}</div>}

          <button className="btn btn-login" type="submit" disabled={busy || !username.trim() || !password}>
            {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>

        <div className="login-switch">
          {mode === 'login' ? (
            <button className="link-btn" onClick={() => { setMode('register'); setError(''); }}>
              没有账号？注册一个
            </button>
          ) : (
            <button className="link-btn" onClick={() => { setMode('login'); setError(''); }}>
              已有账号？直接登录
            </button>
          )}
        </div>

        <div className="login-hint">
          演示账号：admin / admin123（管理员） · demo / demo123（普通用户）
        </div>
      </div>
    </div>
  );
}
