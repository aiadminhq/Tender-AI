// 全域偏好 context：主題 / 語言 / 側欄 + t() 翻譯器。（登入身分改由 auth-context 管理）
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
  loadLang,
  loadSidebarCollapsed,
  loadTheme,
  saveLang,
  saveSidebarCollapsed,
  saveTheme,
  type Theme,
} from "@/lib/storage";

interface AppContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  toggleLang: () => void;
  /** 翻譯器（值為 string 的鍵） */
  t: (key: TextKey) => string;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
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
      sidebarCollapsed,
      toggleSidebar: () => setSidebarCollapsed((v) => !v),
    }),
    [theme, lang, t, sidebarCollapsed],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp 必須在 <AppProvider> 內使用");
  return ctx;
}
