// SL5 主動推播：topbar 通知鈴鐺 + 右側推播面板（願景第 4 點「重自動推播」）。
// 串接 lib/push.ts：GET /push/digest（開啟時抓）、POST /push/run（空狀態手動產生）、
// POST /push/read（標記已讀）。每張卡為 Layer A 安全內容（標案公開欄位 + 可解釋分數/理由），
// 不含人名／email。行為埋點（lib/events.ts）：開啟=view(scope=push_open)、點卡=click_link(scope=push)。
import { useCallback, useEffect, useState } from "react";
import { Bell, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { TierBadge } from "@/components/ui/tier-badge";
import { useApp } from "@/store/app-context";
import { trackEvent } from "@/lib/events";
import { formatBudget } from "@/lib/format";
import {
  fetchPushDigest,
  markPushRead,
  runPush,
  type PushItem,
} from "@/lib/push";
import { cn } from "@/lib/utils";

// 標的類別（後端原始中文）→ 色票。對齊標案列表的工程/勞務/財物配色。
const CATEGORY_CLS: Record<string, string> = {
  工程: "bg-tier-mid/12 text-tier-mid",
  勞務: "bg-primary/12 text-primary",
  財物: "bg-tier-high/12 text-tier-high",
};

// 資料源 → 色票。PCC（政府電子採購網）／TMU（北醫聯合採購）。
const SOURCE_CLS: Record<string, string> = {
  PCC: "bg-primary/12 text-primary",
  TMU: "bg-tier-mid/12 text-tier-mid",
};

export function PushBell() {
  const { t, lang } = useApp();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PushItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(false);

  // 載入推播資料（開啟面板時 / 產生後）。後端未啟動時靜默 fallback。
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

  // 啟動時先抓一次未讀數（不開面板也顯示紅點）。
  useEffect(() => {
    void load();
  }, [load]);

  // 開啟面板：記 view 事件 + 重新載入最新批次。
  useEffect(() => {
    if (!open) return;
    trackEvent("view", { payload: { scope: "push_open" } });
    void load();
  }, [open, load]);

  const onGenerate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setError(false);
    try {
      const result = await runPush();
      setItems(result.items);
      setUnread(result.unread);
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
      setItems((prev) => prev.map((it) => ({ ...it, status: "read" })));
    } catch {
      /* 靜默：標記失敗不阻斷瀏覽 */
    }
  }, []);

  const onItemClick = useCallback((it: PushItem) => {
    trackEvent("click_link", {
      ...(it.tenderId != null ? { tenderId: String(it.tenderId) } : {}),
      payload: { scope: "push", source: it.source ?? undefined },
    });
    if (it.tenderId != null) {
      // BrowserRouter SPA 導頁需整段 href（非 client-side push）。
      window.location.href = `/tenders/${it.tenderId}`;
    }
  }, []);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={t("pushOpen")}
        title={t("pushOpen")}
        className="relative text-primary"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-danger px-1 text-[9px] font-semibold leading-none text-white">
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
            <Bell size={15} className="text-primary" />
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
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-ink-dim">
                {items.length}
                {t("pushUnit")}
              </span>
              <button
                onClick={() => void onMarkAllRead()}
                disabled={unread === 0}
                className="text-[12px] font-medium text-primary transition-colors hover:text-primary/80 disabled:cursor-default disabled:text-ink-dim"
              >
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
              <Button
                onClick={() => void onGenerate()}
                disabled={generating}
                className="mx-auto"
              >
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
          ) : (
            <div className="flex flex-col gap-2.5">
              {items.map((it) => (
                <PushCard
                  key={it.id}
                  item={it}
                  lang={lang}
                  onClick={() => onItemClick(it)}
                />
              ))}
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}

function PushCard({
  item,
  lang,
  onClick,
}: {
  item: PushItem;
  lang: "zh" | "en";
  onClick: () => void;
}) {
  const { t } = useApp();
  const isNew = item.status === "pending";
  const score = item.score != null ? Math.round(item.score) : null;
  const days = item.daysLeft;
  const daysTone =
    days == null
      ? "text-ink-dim"
      : days < 0
        ? "text-ink-dim"
        : days <= 7
          ? "text-danger"
          : "text-ink-muted";

  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex flex-col gap-2 rounded-lg border bg-canvas px-3.5 py-3 text-left transition-colors hover:border-primary/50 hover:bg-accent",
        isNew ? "border-primary/30" : "border-border",
      )}
    >
      {/* 頂列：tier + 符合度 + 新標記 */}
      <div className="flex items-center gap-2">
        {item.tier && <TierBadge tier={item.tier} lang={lang} />}
        {score != null && (
          <span className="text-[11px] font-medium text-ink-muted">
            {t("pushMatch")} {score}%
          </span>
        )}
        {isNew && (
          <span className="ml-auto rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-semibold text-danger">
            {t("pushNew")}
          </span>
        )}
      </div>

      {/* 標案名稱 */}
      <div className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-foreground group-hover:text-primary">
          {item.name ?? `#${item.tenderId ?? "-"}`}
        </span>
        {item.link && (
          <ExternalLink
            size={13}
            className="mt-0.5 shrink-0 text-ink-dim group-hover:text-primary"
          />
        )}
      </div>

      {/* 標籤列：來源 / 類別 / 城市 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {item.source && (
          <Chip
            className={SOURCE_CLS[item.source] ?? "bg-accent text-ink-muted"}
          >
            {item.source}
          </Chip>
        )}
        {item.category && (
          <Chip
            className={
              CATEGORY_CLS[item.category] ?? "bg-accent text-ink-muted"
            }
          >
            {item.category}
          </Chip>
        )}
        {item.city && (
          <Chip className="bg-accent text-ink-muted">{item.city}</Chip>
        )}
      </div>

      {/* 機關 + 預算 + 截止 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-dim">
        {item.org && <span className="truncate">{item.org}</span>}
        {item.budgetWan != null && (
          <span>{formatBudget(item.budgetWan * 10000, lang)}</span>
        )}
        {item.deadlineRoc && (
          <span className={daysTone}>
            {item.deadlineRoc}
            {days != null &&
              days >= 0 &&
              ` · ${days}${lang === "en" ? "d" : " 天"}`}
          </span>
        )}
      </div>

      {/* 推播理由（Layer A 可解釋聚合，不含 PII） */}
      {item.reason && (
        <p className="rounded-md bg-card px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-muted">
          <span className="font-medium text-ink-dim">
            {t("pushReasonLabel")}：
          </span>
          {item.reason}
        </p>
      )}
    </button>
  );
}

function Chip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
        className,
      )}
    >
      {children}
    </span>
  );
}
