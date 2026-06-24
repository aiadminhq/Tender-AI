// 認證 API 對接（Phase 2 輕量登入）：信箱＋密碼驗證身分、本人改密、管理員重置。
// 後端 app/api/v1/{auth,me,admin}.py。
//
// 信任邊界（沿用後端 Phase 1）：登入只驗證憑證、不簽 token；身分存於前端
// localStorage，管理權限暫以 `X-User-Role: admin` header 把關（可偽造，待 Phase 2
// 改伺服器端 session 強制）。密碼明文僅於送出當下存在於記憶體，不落地、不寫版控。
import type { FilterState } from "@/types/domain";

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "http://localhost:8000/api/v1";

function authHeaders(): Record<string, string> {
  const key = import.meta.env.VITE_API_KEY as string | undefined;
  return key ? { "X-API-Key": key } : {};
}

// 後端 LoginOut / MeOut（app/schemas/user.py，snake_case）。
interface AuthUserRaw {
  id: number;
  name: string;
  email: string | null;
  role: string | null;
  whitelist_active: boolean;
  consent_shared: boolean;
  consent_at: string | null;
  password_is_default?: boolean; // LoginOut／MeOut 皆帶（伺服器依儲存雜湊推導）
}

/** 前端登入身分契約（camelCase）。`isAdmin` 由 role 推導，供前端便捷判斷。 */
export interface AuthUser {
  id: number;
  name: string;
  email: string | null;
  role: string | null;
  isAdmin: boolean;
  whitelistActive: boolean;
  consentShared: boolean;
  consentAt: string | null;
  /** 仍為種子預設密碼（建議盡快修改）；登入與 /me 皆由伺服器推導，重整後一致。 */
  passwordIsDefault: boolean;
}

export function adaptAuthUser(r: AuthUserRaw): AuthUser {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    isAdmin: r.role === "admin",
    whitelistActive: r.whitelist_active,
    consentShared: r.consent_shared,
    consentAt: r.consent_at,
    passwordIsDefault: r.password_is_default ?? false,
  };
}

/** 登入帳號的具名顯示資料（頭像不需後端提供，由名稱推導縮寫與穩定底色）。 */
export interface AuthDisplay {
  name: string;
  initials: string;
  color: string;
}

// 設計 token 色相，與 mock USERS 取自同一組調性，彼此可辨識。
const AVATAR_COLORS = [
  "#0099ff",
  "#7c6bff",
  "#22c55e",
  "#f5a623",
  "#ff5577",
  "#06b6d4",
  "#a855f7",
  "#ef7d3b",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 由登入身分推導頭像顯示（縮寫取名稱前兩個字／英文首字母，底色依信箱穩定取色）。
 *  參數放寬為 `Pick<AuthUser,"name"|"email">`：本就只讀這兩欄，供 Member 等衍生頭像。 */
export function authDisplay(u: Pick<AuthUser, "name" | "email">): AuthDisplay {
  const name = u.name || u.email || "?";
  const ascii = /^[\x00-\x7F]+$/.test(name.trim());
  let initials: string;
  if (ascii) {
    const parts = name
      .trim()
      .split(/[\s._@-]+/)
      .filter(Boolean);
    initials = (
      (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")
    ).toUpperCase();
  } else {
    initials = name.trim().slice(0, 2);
  }
  const seed = u.email ?? name;
  return {
    name,
    initials: initials || "?",
    color: AVATAR_COLORS[hashString(seed) % AVATAR_COLORS.length],
  };
}

/** 登入失敗類別：憑證錯誤（401/403）／網路或後端不可達。供 UI 區分提示與退化路徑。 */
export type LoginErrorKind = "credentials" | "network";

export class LoginError extends Error {
  kind: LoginErrorKind;
  constructor(kind: LoginErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "LoginError";
  }
}

/** POST /auth/login：驗證信箱＋密碼。憑證錯誤拋 LoginError("credentials")，
 *  後端不可達拋 LoginError("network")（呼叫端可據此退化為示範模式）。 */
export async function login(
  email: string,
  password: string,
): Promise<AuthUser> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new LoginError("network", "backend unreachable");
  }
  if (res.status === 401 || res.status === 403) {
    throw new LoginError("credentials", "invalid credentials");
  }
  if (!res.ok) throw new LoginError("network", `login API ${res.status}`);
  return adaptAuthUser((await res.json()) as AuthUserRaw);
}

/** GET /me?user_id=：以已存的身分刷新帳戶狀態（重新整理頁面後沿用）。失敗回 null。 */
export async function fetchMe(userId: number): Promise<AuthUser | null> {
  try {
    const res = await fetch(
      `${API_BASE}/me?user_id=${encodeURIComponent(userId)}`,
      { headers: authHeaders() },
    );
    if (!res.ok) return null;
    return adaptAuthUser((await res.json()) as AuthUserRaw);
  } catch {
    return null;
  }
}

/** 本人設定／撤回共享同意後的最新狀態（PUT /me/consent 回傳）。 */
export interface ConsentResult {
  consentShared: boolean;
  consentAt: string | null;
}

/** PUT /me/consent：本人設定／撤回 Layer B 共享同意（第 2 段）。
 *  成功回最新同意狀態；後端不可達／非 200 回 null（呼叫端不就地改狀態）。
 *  撤回同意（false）後，後端即停止把本人行為匯入共享庫（對外隔離邊界，見 CLAUDE.md）。 */
export async function setConsent(
  userId: number,
  consentShared: boolean,
): Promise<ConsentResult | null> {
  try {
    const res = await fetch(`${API_BASE}/me/consent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ user_id: userId, consent_shared: consentShared }),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      consent_shared: boolean;
      consent_at: string | null;
    };
    return { consentShared: d.consent_shared, consentAt: d.consent_at };
  } catch {
    return null;
  }
}

/** 改密／重置結果：errors 對應後端 403（舊密碼錯）／422（太短）／404（查無帳號）。 */
export type PasswordResult =
  | { ok: true; user: AuthUser }
  | { ok: false; kind: "wrong_old" | "too_short" | "not_found" | "network" };

/** PUT /me/password：本人改密（須帶舊密碼）。 */
export async function changePassword(
  userId: number,
  oldPassword: string,
  newPassword: string,
): Promise<PasswordResult> {
  try {
    const res = await fetch(`${API_BASE}/me/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        user_id: userId,
        old_password: oldPassword,
        new_password: newPassword,
      }),
    });
    if (res.status === 403) return { ok: false, kind: "wrong_old" };
    if (res.status === 422) return { ok: false, kind: "too_short" };
    if (!res.ok) return { ok: false, kind: "network" };
    return { ok: true, user: adaptAuthUser((await res.json()) as AuthUserRaw) };
  } catch {
    return { ok: false, kind: "network" };
  }
}

/** POST /admin/users/{id}/password：管理員重置某帳號密碼（暫以 X-User-Role 把關）。 */
export async function adminSetPassword(
  userId: number,
  newPassword: string,
): Promise<PasswordResult> {
  try {
    const res = await fetch(
      `${API_BASE}/admin/users/${encodeURIComponent(userId)}/password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Role": "admin",
          ...authHeaders(),
        },
        body: JSON.stringify({ new_password: newPassword }),
      },
    );
    if (res.status === 422) return { ok: false, kind: "too_short" };
    if (res.status === 404) return { ok: false, kind: "not_found" };
    if (!res.ok) return { ok: false, kind: "network" };
    return { ok: true, user: adaptAuthUser((await res.json()) as AuthUserRaw) };
  } catch {
    return { ok: false, kind: "network" };
  }
}

// 後端 WhitelistOut（管理員列出所有帳號與白名單／同意狀態）。
interface WhitelistRaw {
  id: number;
  name: string;
  email: string | null;
  role: string | null;
  whitelist_active: boolean;
  consent_shared: boolean;
  consent_at: string | null;
}

/** 管理員可見的帳號列（供成員密碼管理列表）。 */
export interface AccountRow {
  id: number;
  name: string;
  email: string | null;
  role: string | null;
  isAdmin: boolean;
  whitelistActive: boolean;
  consentShared: boolean;
}

/** GET /admin/whitelist：列出所有帳號（管理員）。失敗回 null。 */
export async function fetchAccounts(): Promise<AccountRow[] | null> {
  try {
    const res = await fetch(`${API_BASE}/admin/whitelist`, {
      headers: { "X-User-Role": "admin", ...authHeaders() },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as WhitelistRaw[];
    return data.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      isAdmin: r.role === "admin",
      whitelistActive: r.whitelist_active,
      consentShared: r.consent_shared,
    }));
  } catch {
    return null;
  }
}

/** POST /admin/whitelist：管理員開通／關閉某帳號白名單（best-effort，暫以 X-User-Role 把關）。
 *  成功回 true；非 admin（403）／查無／後端不可達皆回 false。前端優先：本地 members 仍為事實來源，
 *  此呼叫僅在 live+admin 時盡力同步後端，失敗不阻塞本地切換。 */
export async function setWhitelist(
  email: string,
  whitelistActive: boolean,
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/admin/whitelist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Role": "admin",
        ...authHeaders(),
      },
      body: JSON.stringify({ email, whitelist_active: whitelistActive }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// FilterState 僅為型別重匯出佔位，避免 lint 對未使用 import 報錯時的循環顧慮。
export type { FilterState };
