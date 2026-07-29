// 登入身分 context（Phase 2 真鑑權）：信箱＋密碼驗證後，後端簽發 HMAC token，
// 前端存於 localStorage（auth-token），之後請求帶 Authorization: Bearer。
//
// 兩種登入態：
//   - "authed"：以白名單帳號通過後端驗證，行為依登入帳號具名回寫（token 帶 uid）。
//   - "mock" ：後端不可達時的退化／示範模式，維持離線可用；不存 token、不具名。
// 信任邊界：身分／角色／白名單一律由後端依 token 推導（不再信任前端帶入的 user_id／X-User-Role）。
// 開站以 GET /me 重新核對（fail-closed）：token 失效／帳號停用 → fetchMe 回 null → 自動登出清 token。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchMe,
  login as apiLogin,
  loginWithSupabaseToken,
  setConsent as apiSetConsent,
  type AuthUser,
} from "@/lib/auth-api";
import { setCurrentUserId } from "@/lib/api";
import { load, remove, save } from "@/lib/storage";
import { getToken, setToken, clearToken } from "@/lib/auth-token";
import {
  getSupabaseSession,
  signInWithGoogle,
  signOutSupabase,
  supabase,
} from "@/lib/supabase-auth";

const STORAGE_KEY = "auth-user"; // tender:auth-user

export type AuthStatus = "loading" | "anonymous" | "authed" | "mock";

interface AuthContextValue {
  status: AuthStatus;
  /** 已登入身分（authed 與 mock 皆有）；anonymous/loading 為 null。 */
  user: AuthUser | null;
  /** 是否為管理員（僅 authed 真實角色才為真）。 */
  isAdmin: boolean;
  /** 是否為退化／示範模式（後端不可達）。 */
  isMock: boolean;
  /** 登入：成功回 true；憑證錯誤回 false；後端不可達拋給呼叫端決定是否退化。 */
  login: (email: string, password: string, shareLayerB?: boolean) => Promise<boolean>;
  /** 以 Supabase Google OAuth 登入；回呼後仍由後端白名單核准。 */
  loginWithGoogle: () => Promise<void>;
  /** 進入示範模式（後端不可達時的明確降級入口）。 */
  enterMock: () => void;
  logout: () => void;
  /** 改密／管理員重置後，以最新帳戶狀態覆寫（含 passwordIsDefault 清除）。 */
  refreshUser: (next: AuthUser) => void;
  /** 本人設定／撤回 Layer B 共享同意；成功回 true 並同步身分，失敗回 false（不改狀態）。 */
  updateConsent: (consentShared: boolean) => Promise<boolean>;
}

const MOCK_USER: AuthUser = {
  id: 0,
  name: "示範使用者",
  email: null,
  role: "member",
  isAdmin: false,
  whitelistActive: false,
  consentShared: false,
  consentAt: null,
  passwordIsDefault: false,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // 啟動時還原上次登入身分（authed）；mock 不留存（每次明確降級）。
  const [user, setUser] = useState<AuthUser | null>(() =>
    load<AuthUser | null>(STORAGE_KEY, null),
  );
  const [status, setStatus] = useState<AuthStatus>(() =>
    load<AuthUser | null>(STORAGE_KEY, null) ? "loading" : "anonymous",
  );

  const exchangeSupabaseSession = useCallback(async (accessToken: string) => {
    const { user: nextUser, token } = await loginWithSupabaseToken(accessToken);
    setToken(token);
    save(STORAGE_KEY, nextUser);
    setUser(nextUser);
    setStatus("authed");
  }, []);

  // 已登入身分 → 注入 api.ts 供行為具名回寫；登出／示範模式清除。
  useEffect(() => {
    setCurrentUserId(status === "authed" && user ? user.id : null);
  }, [status, user]);

  // 還原的身分以 GET /me 重新核對（fail-closed）：token 失效／帳號停用 → 自動登出清 token。
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!getToken()) {
        setStatus("anonymous");
        return;
      }
      const me = await fetchMe(); // 靠 Bearer，失敗／401 回 null
      if (!alive) return;
      if (!me) {
        // token 失效／帳號停用 → fail-closed 登出
        clearToken();
        remove(STORAGE_KEY);
        setUser(null);
        setStatus("anonymous");
        return;
      }
      setUser(me);
      save(STORAGE_KEY, me);
      setStatus("authed");
    })();
    return () => {
      alive = false;
    };
    // 僅在掛載時核對一次
  }, []);

  // OAuth callback 會把 Supabase session 留在 browser storage；交換成 Tender AI
  // token 後，後續 API 仍沿用既有後端信任邊界。
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const exchange = async (accessToken: string) => {
      if (!alive || getToken()) return;
      try {
        await exchangeSupabaseSession(accessToken);
      } catch {
        if (!alive) return;
        clearToken();
        remove(STORAGE_KEY);
        setUser(null);
        setStatus("anonymous");
        void signOutSupabase();
      }
    };

    void getSupabaseSession().then((session) => {
      if (session?.access_token) void exchange(session.access_token);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) void exchange(session.access_token);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [exchangeSupabaseSession]);

  const login = useCallback(
    async (
      email: string,
      password: string,
      shareLayerB = false,
    ): Promise<boolean> => {
      // 憑證錯誤 → 回 false；網路錯誤 → 由 apiLogin 拋 LoginError("network")，
      // 交呼叫端（登入頁）決定是否提示「改用示範模式」。
      try {
        const { user: u, token } = await apiLogin(email, password);
        setToken(token);
        let nextUser = u;
        if (shareLayerB && !u.consentShared) {
          const consent = await apiSetConsent(true);
          if (consent) {
            nextUser = {
              ...u,
              consentShared: consent.consentShared,
              consentAt: consent.consentAt,
            };
          }
        }
        setUser(nextUser);
        save(STORAGE_KEY, nextUser);
        setStatus("authed");
        return true;
      } catch (err) {
        if (
          err &&
          typeof err === "object" &&
          "kind" in err &&
          (err as { kind: string }).kind === "credentials"
        ) {
          return false;
        }
        throw err; // network：上拋
      }
    },
    [],
  );

  const enterMock = useCallback(() => {
    if (!import.meta.env.DEV) return;
    setUser(MOCK_USER);
    setStatus("mock");
    remove(STORAGE_KEY); // 示範身分不留存
  }, []);

  const loginWithGoogle = useCallback(async () => {
    await signInWithGoogle();
  }, []);

  const logout = useCallback(() => {
    clearToken();
    remove(STORAGE_KEY);
    setUser(null);
    setStatus("anonymous");
  }, []);

  const refreshUser = useCallback(
    (next: AuthUser) => {
      setUser(next);
      if (status === "authed") save(STORAGE_KEY, next);
    },
    [status],
  );

  // 本人切換 Layer B 共享同意：僅 authed 真實帳號可改（mock 無後端帳號）。
  // 成功後以後端回傳的 consentShared/consentAt 覆寫並留存身分。
  const updateConsent = useCallback(
    async (consentShared: boolean): Promise<boolean> => {
      if (status !== "authed" || !user) return false;
      const res = await apiSetConsent(consentShared);
      if (!res) return false;
      const next: AuthUser = {
        ...user,
        consentShared: res.consentShared,
        consentAt: res.consentAt,
      };
      setUser(next);
      save(STORAGE_KEY, next);
      return true;
    },
    [status, user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isAdmin: status === "authed" && !!user?.isAdmin,
      isMock: status === "mock",
      login,
      loginWithGoogle,
      enterMock,
      logout,
      refreshUser,
      updateConsent,
    }),
    [
      status,
      user,
      login,
      loginWithGoogle,
      enterMock,
      logout,
      refreshUser,
      updateConsent,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必須在 <AuthProvider> 內使用");
  return ctx;
}
