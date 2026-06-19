// 在地化格式化工具：預算 / 日期 / 相對時間 / 截止天數。
// app 端可用 new Date() / Date.now()（非 workflow 腳本）。
import type { Lang } from "@/i18n/strings";

const locale = (lang: Lang) => (lang === "en" ? "en-US" : "zh-TW");

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 預算金額（TWD）→ 在地化短格式。zh：萬／億；en：NT$ K／M。 */
export function formatBudget(twd: number, lang: Lang): string {
  if (lang === "en") {
    if (twd >= 1_000_000) return `NT$${trim(twd / 1_000_000)}M`;
    if (twd >= 1_000) return `NT$${Math.round(twd / 1_000)}K`;
    return `NT$${twd}`;
  }
  if (twd >= 100_000_000) return `${trim(twd / 100_000_000)} 億`;
  if (twd >= 10_000) return `${trim(twd / 10_000)} 萬`;
  return String(twd);
}

/** 千分位整數 */
export function formatInt(n: number, lang: Lang): string {
  return n.toLocaleString(locale(lang));
}

/** ISO date → 短日期（在地化 MM/DD） */
export function formatDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    month: "numeric",
    day: "numeric",
  }).format(new Date(iso));
}

/** ISO date → 完整日期（含年） */
export function formatDateLong(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

/** 距今相對時間（即時動態用） */
export function formatRelative(iso: string, lang: Lang): string {
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto" });
  const diffSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 604_800) return rtf.format(Math.round(diffSec / 86_400), "day");
  return formatDate(iso, lang);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 距截止天數（>0 還剩 N 天，0 今天截止，<0 已過） */
export function daysLeft(iso: string): number {
  const ms = startOfDay(new Date(iso)) - startOfDay(new Date());
  return Math.round(ms / 86_400_000);
}
