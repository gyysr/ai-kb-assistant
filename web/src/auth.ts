// ===== 登录凭证仓库：token 的存、取、清 + "登录失效"广播 =====
// 登录成功后的 JWT token 和用户信息存进浏览器 localStorage —— 刷新页面、
// 关掉重开都不丢，直到退出登录或 token 过期。api.ts 发请求时来这儿取
// token；收到 401 时通过这儿广播"未授权"事件

import type { AuthState } from './types';

// localStorage 里存登录态用的键名。抽成常量：存和读共用一个名字，不会拼错
const STORAGE_KEY = 'kb_auth';
// 自定义事件名（window 上的"广播频道"）。任何接口收到 401（token 过期/无效）
// 就派发它，App.tsx 统一监听并跳回登录页 —— 各页面不用各自写这套处理
export const UNAUTHORIZED_EVENT = 'kb:unauthorized';

// 从 localStorage 读回登录态。三重防御：没存过 / 存的不是合法 JSON /
// 缺 token 或用户名，一律当作"没登录"返回 null —— 调用方只需判空一种情况
export function loadAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthState;
    if (!parsed?.token || !parsed?.user?.username) return null;
    return parsed;
  } catch {
    return null;
  }
}

// localStorage 只能存字符串，所以整个对象先 JSON.stringify 成文本再落盘
export function saveAuth(state: AuthState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// 退出登录/登录过期时调用：把这个键整条删掉，本地登录态归零
export function clearAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// 每次发请求都"现读"一次 localStorage 拿 token，而不是缓存启动时的旧值：
// 登录、换号后不用刷新页面，新 token 立刻生效。没登录时返回空对象 ——
// 展开进 headers 等于什么都不加，不会多出 undefined 之类的脏字段
export function authHeader(): Record<string, string> {
  const auth = loadAuth();
  return auth ? { Authorization: `Bearer ${auth.token}` } : {};
}

// 在 window 上派发一个自定义事件（浏览器自带的事件广播机制，和"点击按钮"
// 是同一套体系）。本函数只负责"喊一嗓子"，谁在听、听完做什么由 App.tsx 决定
export function notifyUnauthorized(): void {
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
}
