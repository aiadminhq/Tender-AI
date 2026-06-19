// 全域偏好 context：主題 / 語言 / 登入身分 + t() 翻譯器。
// 主題寫入 <html data-theme>、語言寫入 <html lang>，並持久化（與 pre-paint 一致）。
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
  load,
  loadLang,
  loadSidebarCollapsed,
  loadTheme,
  save,
  saveLang,
  saveSidebarCollapsed,
  saveTheme,
  type Theme,
} from "@/lib/storage";
import { USERS } from "@/data/users";
import type { User } from "@/types/domain";

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
  setPerson: (id: string) => void;
  users: User[];
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  const [lang, setLangState] = useState<Lang>(loadLang);
  const [personId, setPersonId] = useState<string>(() =>
    load("person", USERS[0].id),
  );
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
    save("person", personId);
  }, [personId]);

  useEffect(() => {
    saveSidebarCollapsed(sidebarCollapsed);
  }, [sidebarCollapsed]);

  const t = useMemo(() => {
    const dict = STRINGS[lang];
    return (key: TextKey) => dict[key] as string;
  }, [lang]);

  const person = useMemo(
    () => USERS.find((u) => u.id === personId) ?? USERS[0],
    [personId],
  );

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
      setPerson: setPersonId,
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
