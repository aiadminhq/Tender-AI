// 全域偏好 context：主題 / 語言 / 登入身分 + t() 翻譯器。
// 主題寫入 <html data-theme>、語言寫入 <html lang>，並持久化（與 pre-paint 一致）。
//
// person（目前登入者）改由 auth-context 的白名單登入 session 決定，
// 不再是 demo 用的手動身分切換（見 person-menu.tsx）；users 仍是團隊成員
// 名單（指派看板卡片等場景用），與登入身分是兩件事，維持獨立。
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { STRINGS, type Lang, type TextKey } from "@/i18n/strings";
import {
  loadLang,
  loadSidebarCollapsed,
  loadTheme,
  saveLang,
  saveSidebarCollapsed,
  saveTheme,
  type Theme,
} from "@/lib/storage";
import { USERS } from "@/data/users";
import type { User } from "@/types/domain";
import { useAuth } from "@/store/auth-context";

const AVATAR_COLORS = ["#0099ff", "#7c6bff", "#22c55e", "#f5a623", "#ff5577"];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.length >= 2 ? [parts[0][0], parts[1][0]] : [name.slice(0, 2)];
  return chars.join("").toUpperCase();
}

const ROLE_LABEL_ZH: Record<string, string> = {
  admin: "管理者",
  member: "成員",
};

interface AppContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  toggleLang: () => void;
  /** 翻譯器（值為 string 的鍵） */
  t: (key: TextKey) => string;
  person: User;
  users: User[];
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { user: authUser } = useAuth();
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  const [lang, setLangState] = useState<Lang>(loadLang);
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState<boolean>(loadSidebarCollapsed);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang === "en" ? "en" : "zh-Hant-TW";
    saveLang(lang);
  }, [lang]);

  useEffect(() => {
    saveSidebarCollapsed(sidebarCollapsed);
  }, [sidebarCollapsed]);

  const t = useMemo(() => {
    const dict = STRINGS[lang];
    return (key: TextKey) => dict[key] as string;
  }, [lang]);

  // person＝目前登入者：RequireAuth 已擋掉未登入狀態，故 authUser 理應必為非 null；
  // 保留 USERS[0] fallback 只為型別安全與掛載瞬間的邊界情況。
  const person = useMemo<User>(() => {
    if (!authUser) return USERS[0];
    const role = authUser.role ? (ROLE_LABEL_ZH[authUser.role] ?? authUser.role) : "成員";
    return {
      id: String(authUser.id),
      name: authUser.name,
      initials: initialsOf(authUser.name),
      role,
      color: AVATAR_COLORS[authUser.id % AVATAR_COLORS.length],
    };
  }, [authUser]);

  const value = useMemo<AppContextValue>(
    () => ({
      theme,
      setTheme: setThemeState,
      toggleTheme: () =>
        setThemeState((p) => (p === "dark" ? "light" : "dark")),
      lang,
      setLang: setLangState,
      toggleLang: () => setLangState((p) => (p === "zh" ? "en" : "zh")),
      t,
      person,
      users: USERS,
      sidebarCollapsed,
      toggleSidebar: () => setSidebarCollapsed((v) => !v),
    }),
    [theme, lang, t, person, sidebarCollapsed],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp 必須在 <AppProvider> 內使用");
  return ctx;
}
