// ===== 登录视图：整个应用的门卫 =====
// 没登录时 App.tsx 只渲染这个组件；登录/注册成功后把结果通过 onLogin 交回
// App，由 App 把 token 存进 localStorage（刷新页面不丢）并切到主界面。
// 登录和注册两个表单共用这一个文件，靠下面的 mode 切换

import { useState } from 'react';
import { login, register } from '../api';
import type { AuthState } from '../types';

// onLogin 是"登录成功的回执"：本组件不关心 token 存哪、界面怎么切，
// 只把结果递出去 —— 子组件上报、父组件决策
export default function LoginView({ onLogin }: { onLogin: (state: AuthState) => void }) {
  // useState 是 React 组件的"记忆"：返回 [当前值, 修改函数]，值一变组件自动重渲染。
  // mode 决定当前显示登录表单还是注册表单
  const [mode, setMode] = useState<'login' | 'register'>('login');
  // 用户名/密码是"受控输入"：input 的 value 绑定 state、敲键时 onChange 更新
  // state，输入框显示什么完全由 React 状态说了算，代码随时能读到最新值
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // 错误提示文案。空串 = 没有错误（配合下面的 && 判断，红字就不渲染）
  const [error, setError] = useState('');
  // 提交中标记：置灰按钮、防止连点造成重复请求
  const [busy, setBusy] = useState(false);

  // 表单提交处理器。第一步必须 preventDefault：阻止浏览器默认的
  // "提交就整页刷新"行为，改成走下面的异步请求
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 已在提交中就忽略这次触发
    if (busy) return;
    // 每次提交前清掉旧错误，避免上一次的报错一直挂在页面上
    setError('');
    setBusy(true);
    try {
      // 按当前模式调登录或注册接口。用户名 trim 去首尾空格；
      // 密码不 trim —— 密码里的空格可能是用户故意输的
      const state =
        mode === 'login'
          ? await login(username.trim(), password)
          : await register(username.trim(), password);
      // 成功：把登录态递给 App。存 token、切界面是 App 的事（见 App.tsx 的 onLogin）
      onLogin(state);
    } catch (err) {
      // 失败：接口抛的 Error 里带服务器给的中文提示，直接展示给用户
      setError(err instanceof Error ? err.message : '操作失败，请重试');
    } finally {
      // finally 无论成败都执行：解除忙碌状态，按钮恢复可点
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

          {/* && 的短路用法：error 为空串时右边整块不渲染，有错才显示红字提示 */}
          {error && <div className="login-error">{error}</div>}

          {/* 用户名/密码没填全或正在提交时 disabled 置灰，点了也不触发提交 */}
          <button className="btn btn-login" type="submit" disabled={busy || !username.trim() || !password}>
            {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>

        {/* 登录 ↔ 注册模式切换。切的同时清掉旧错误提示 */}
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

        {/* 演示账号提示，方便第一次打开的人直接试 */}
        <div className="login-hint">
          演示账号：admin / admin123（管理员） · demo / demo123（普通用户）
        </div>
      </div>
    </div>
  );
}
