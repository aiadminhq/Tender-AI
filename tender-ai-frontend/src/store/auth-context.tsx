// 白名單登入（@hqdesign.tw）context：取代舊有「登入身分切換」demo 下拉。
// 真正的使用者身分改由這裡的登入 session 決定（見 person-menu.tsx / app-context.tsx）。
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { login as loginRequest } from "@/lib/auth-api";
import {
  clearAuthSession,
  loadAuthSession,
  saveAuthSession,
  type AuthUser,
} from "@/lib/auth-token";

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** 成功回 null；帳密錯誤／未開通白名單回傳錯誤訊息。 */
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(
    () => loadAuthSession()?.user ?? null,
  );

  const login = useCallback(async (email: string, password: string) => {
    if (!email.trim().toLowerCase().endsWith("@hqdesign.tw")) {
      return "請使用 @hqdesign.tw 公司信箱登入";
    }
    let session;
    try {
      session = await loginRequest(email.trim(), password);
    } catch {
      return "無法連線到伺服器，請稍後再試";
    }
    if (!session) return "帳號、密碼錯誤，或尚未開通白名單";
    saveAuthSession(session);
    setUser(session.user);
    return null;
  }, []);

  const logout = useCallback(() => {
    clearAuthSession();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAuthenticated: user !== null, login, logout }),
    [user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必須在 <AuthProvider> 內使用");
  return ctx;
}
