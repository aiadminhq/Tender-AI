// 白名單登入（@hqdesign.tw）API：POST /auth/login。後端 app/api/v1/auth.py。
import { API_BASE } from "@/lib/api";
import type { AuthSession } from "@/lib/auth-token";

interface LoginResponseRaw {
  access_token: string;
  token_type: string;
  user: { id: number; name: string; email: string | null; role: string | null };
}

/** 登入失敗（帳密錯誤／未開通白名單）回傳 null；網路/伺服器錯誤 throw。 */
export async function login(
  email: string,
  password: string,
): Promise<AuthSession | null> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`login API ${res.status}`);
  const data = (await res.json()) as LoginResponseRaw;
  return { token: data.access_token, user: data.user };
}
