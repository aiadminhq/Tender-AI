// src/lib/auth-token.ts
// Phase 2 鑑權 token 的單一存取點（localStorage，邏輯 key "auth-token"）。
import { load, save, remove } from "@/lib/storage";

const TOKEN_KEY = "auth-token";

export function getToken(): string | null {
  const t = load<string>(TOKEN_KEY, "");
  return t || null;
}

export function setToken(token: string): void {
  save(TOKEN_KEY, token);
}

export function clearToken(): void {
  remove(TOKEN_KEY);
}
