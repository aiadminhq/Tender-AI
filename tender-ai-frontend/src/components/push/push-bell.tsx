// 主動推播：Topbar 鈴鐺 + 右側推播面板。資料皆為 Layer A 公開欄位與可解釋分數／理由。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, Loader2, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApp } from "@/store/app-context";
import { trackEvent } from "@/lib/events";
import { cn } from "@/lib/utils";
import {
  fetchPushDigest,
  markPushRead,
  runPush,
  type PushItem,
} from "@/lib/push";
import { PushCard } from "./push-card";

type PushFilter = "all" | "unread";

export function PushBell() {
  const { t, lang } = useApp();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PushItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<PushFilter>("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const digest = await fetchPushDigest();
      setItems(digest.items);
      setUnread(digest.unread);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    trackEvent("view", { payload: { scope: "push_open" } });
    void load();
  }, [open, load]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "unread" && item.status !== "pending") return false;
      if (!normalized) return true;
      return [item.name, item.org, item.category, item.city, item.source]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [filter, items, query]);

  const onGenerate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setError(false);
    try {
      const result = await runPush();
      setItems(result.items);
      setUnread(result.unread);
      setFilter("all");
    } catch {
      setError(true);
    } finally {
      setGenerating(false);
    }
  }, [generating]);

  const onMarkAllRead = useCallback(async () => {
    try {
      await markPushRead();
      setUnread(0);
      setItems((prev) => prev.map((item) => ({ ...item, status: "read" })));
    } catch {
      // 標記失敗不阻斷使用者閱讀既有推播。
    }
  }, []);

  const onItemClick = useCallback((item: PushItem) => {
    trackEvent("click_link", {
      ...(item.tenderId != null ? { tenderId: String(item.tenderId) } : {}),
      payload: { scope: "push", source: item.source ?? undefined },
    });
    if (item.tenderId != null) window.location.href = `/tenders/${item.tenderId}`;
  }, []);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={t("pushOpen")}
        title={t("pushOpen")}
        className="relative rounded-lg border border-transparent text-primary transition-all hover:border-primary/20 hover:bg-primary/8 hover:shadow-sm"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-danger px-1 text-[9px] font-semibold leading-none text-white ring-2 ring-card">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        width="sm:max-w-lg"
        title={
          <span className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
              <Bell size={15} />
            </span>
            {t("pushTitle")}
            {unread > 0 && (
              <span className="rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium text-danger">
                {unread}
              </span>
            )}
          </span>
        }
        footer={
          items.length > 0 ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-ink-dim">
                {visibleItems.length}/{items.length}
                {t("pushUnit")}
              </span>
              <button
                onClick={() => void onMarkAllRead()}
                disabled={unread === 0}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary transition-colors hover:text-primary/80 disabled:cursor-default disabled:text-ink-dim"
              >
                <CheckCheck size={14} />
                {unread === 0 ? t("pushAllRead") : t("pushMarkAllRead")}
              </button>
            </div>
          ) : undefined
        }
      >
        <div className="flex h-full flex-col gap-3">
          <p className="text-[12px] leading-relaxed text-ink-dim">
            {t("pushSubtitle")}
          </p>

          <div className="rounded-xl border border-border bg-surface-1/70 p-2.5">
            <div className="flex items-center gap-1 rounded-lg bg-surface-2/75 p-1">
              {(["all", "unread"] as const).map((option) => {
                const active = filter === option;
                const label = option === "all" ? t("pushFilterAll") : t("pushFilterUnread");
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setFilter(option)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all",
                      active
                        ? "bg-card text-ink shadow-sm"
                        : "text-ink-dim hover:text-ink-muted",
                    )}
                  >
                    {option === "unread" && <SlidersHorizontal size={12} />}
                    {label}
                    {option === "unread" && unread > 0 && (
                      <span className="rounded-full bg-danger/15 px-1 text-[9px] text-danger">
                        {unread}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="relative mt-2.5">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-dim"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("pushFilterSearch")}
                className="h-8 border-transparent bg-card pl-8 text-[12px] shadow-none focus-visible:border-primary/30 focus-visible:ring-primary/15"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-ink-muted">
              <Loader2 size={15} className="animate-spin" />
              {t("pushGenerating")}
            </div>
          ) : items.length === 0 ? (
            <div className="space-y-4 py-6 text-center">
              <p className="px-2 text-[13px] leading-relaxed text-ink-muted">
                {error ? t("pushError") : t("pushEmpty")}
              </p>
              <Button onClick={() => void onGenerate()} disabled={generating} className="mx-auto">
                {generating ? (
                  <>
                    <Loader2 size={15} className="mr-1.5 animate-spin" />
                    {t("pushGenerating")}
                  </>
                ) : (
                  <>
                    <Sparkles size={15} className="mr-1.5" />
                    {t("pushGenerate")}
                  </>
                )}
              </Button>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-[12px] text-ink-muted">
              {t("pushNoResults")}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {visibleItems.map((item) => (
                <PushCard
                  key={item.id}
                  item={item}
                  lang={lang}
                  onClick={() => onItemClick(item)}
                />
              ))}
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
