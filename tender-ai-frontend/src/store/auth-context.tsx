// 登入身分 context（Phase 2 輕量登入）：信箱＋密碼驗證後，把身分存於 localStorage、
// 並把 user_id 注入 api.ts（Layer B 具名回寫）。
//
// 兩種登入態：
//   - "authed"：以白名單帳號通過後端驗證，行為依登入帳號具名回寫。
//   - "mock" ：後端不可達時的退化／示範模式，維持離線可用；不注入 user_id（不具名）。
// 信任邊界（沿用後端 Phase 1）：前端不持有 token，身分可被竄改；管理權限暫以
// X-User-Role header 把關。待 Phase 2 改伺服器端 session 強制。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchMe, login as apiLogin, type AuthUser } from "@/lib/auth-api";
import { setCurrentUserId } from "@/lib/api";
import { load, remove, save } from "@/lib/storage";

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
  login: (email: string, password: string) => Promise<boolean>;
  /** 進入示範模式（後端不可達時的明確降級入口）。 */
  enterMock: () => void;
  logout: () => void;
  /** 改密／管理員重置後，以最新帳戶狀態覆寫（含 passwordIsDefault 清除）。 */
  refreshUser: (next: AuthUser) => void;
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

  // 已登入身分 → 注入 api.ts 供行為具名回寫；登出／示範模式清除。
  useEffect(() => {
    setCurrentUserId(status === "authed" && user ? user.id : null);
  }, [status, user]);

  // 還原的身分以 GET /me 重新核對（帳號可能已停用／改密）；後端不可達則沿用快取身分。
  useEffect(() => {
    if (status !== "loading" || !user) return;
    let alive = true;
    void fetchMe(user.id).then((fresh) => {
      if (!alive) return;
      if (fresh) {
        setUser(fresh);
        save(STORAGE_KEY, fresh);
      }
      setStatus("authed"); // 後端不可達（fresh=null）仍沿用快取身分，維持登入
    });
    return () => {
      alive = false;
    };
    // 僅在首次 loading 時核對一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      // 憑證錯誤 → 回 false；網路錯誤 → 由 apiLogin 拋 LoginError("network")，
      // 交呼叫端（登入頁）決定是否提示「改用示範模式」。
      try {
        const u = await apiLogin(email, password);
        setUser(u);
        save(STORAGE_KEY, u);
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
    setUser(MOCK_USER);
    setStatus("mock");
    remove(STORAGE_KEY); // 示範身分不留存
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setStatus("anonymous");
    remove(STORAGE_KEY);
  }, []);

  const refreshUser = useCallback(
    (next: AuthUser) => {
      setUser(next);
      if (status === "authed") save(STORAGE_KEY, next);
    },
    [status],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isAdmin: status === "authed" && !!user?.isAdmin,
      isMock: status === "mock",
      login,
      enterMock,
      logout,
      refreshUser,
    }),
    [status, user, login, enterMock, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必須在 <AuthProvider> 內使用");
  return ctx;
}
