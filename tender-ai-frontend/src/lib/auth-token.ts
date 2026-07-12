// 白名單登入 token 存取（localStorage 持久化）。獨立成小模組避免
// api.ts（authHeaders）與 auth-context.tsx 互相 import 造成循環依賴。
import { load, remove, save } from "@/lib/storage";

export interface AuthUser {
  id: number;
  name: string;
  email: string | null;
  role: string | null;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}

const KEY = "auth";

export function loadAuthSession(): AuthSession | null {
  return load<AuthSession | null>(KEY, null);
}

export function saveAuthSession(session: AuthSession): void {
  save(KEY, session);
}

export function clearAuthSession(): void {
  remove(KEY);
}
