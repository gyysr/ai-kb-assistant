import type { AuthState } from './types';

const STORAGE_KEY = 'kb_auth';
export const UNAUTHORIZED_EVENT = 'kb:unauthorized';

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

export function saveAuth(state: AuthState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function authHeader(): Record<string, string> {
  const auth = loadAuth();
  return auth ? { Authorization: `Bearer ${auth.token}` } : {};
}

export function notifyUnauthorized(): void {
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
}
