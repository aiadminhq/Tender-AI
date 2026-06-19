// localStorage 封裝。一般狀態用 "tender:" 前綴；
// theme / lang 用「裸」key（tender-theme / tender-lang），與 index.html
// 的 pre-paint 腳本共用，避免 FOUC。
import type { Lang } from "@/i18n/strings";

const PREFIX = "tender:";

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota 滿 / 隱私模式：忽略 */
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* noop */
  }
}

/* ---- theme / lang（與 pre-paint 腳本共用裸 key） ---- */
const THEME_KEY = "tender-theme";
const LANG_KEY = "tender-lang";

export type Theme = "dark" | "light";

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* noop */
  }
}

export function loadLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

export function saveLang(lang: Lang): void {
  // 與 pre-paint 腳本一致：en 存 "en"，其餘存完整 BCP-47。
  try {
    localStorage.setItem(LANG_KEY, lang === "en" ? "en" : "zh-Hant-TW");
  } catch {
    /* noop */
  }
}

/* ---- sidebar collapsed（裸 key，"1"=收合 / "0"=展開） ---- */
const SIDEBAR_KEY = "tender-sidebar";

export function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(v: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, v ? "1" : "0");
  } catch {
    /* noop */
  }
}
