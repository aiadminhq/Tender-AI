// SL5 推播工作頁 /push：通知鈴鐺（push-bell）的「完整版」。
// 多一層產生設定（每批數量／最低符合度／回溯天數），按下後 POST /push/run，
// 下方即時預覽最新批次（複用共用 <PushCard/>，皆 Layer A 安全內容）。
// 行為埋點：進頁=view(scope=push_page)、點卡=click_link(scope=push_page)。
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useApp } from "@/store/app-context";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { PushCard } from "@/components/push/push-card";
import { trackEvent } from "@/lib/events";
import {
  fetchPushDigest,
  markPushRead,
  runPush,
  type PushItem,
} from "@/lib/push";

export function PushPage() {
  const { t, lang } = useApp();
  const [items, setItems] = useState<PushItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(false);
  const [lastRun, setLastRun] = useState<{
    created: number;
    skipped: number;
  } | null>(null);

  // 產生條件（送往 POST /push/run）。預設對齊鈴鐺：每批 10、不限分數、回溯 7 天。
  const [limit, setLimit] = useState(10);
  const [minScore, setMinScore] = useState(0);
  const [lookbackDays, setLookbackDays] = useState(7);

  const limitOptions = [5, 10, 20, 30].map((n) => ({
    value: String(n),
    label: lang === "en" ? String(n) : `${n} 筆`,
  }));
  const minScoreOptions = [0, 50, 60, 70, 80].map((n) => ({
    value: String(n),
    label: n === 0 ? t("pushAny") : `${n}%`,
  }));
  const lookbackOptions = [1, 3, 7, 14].map((n) => ({
    value: String(n),
    label: lang === "en" ? `${n}d` : `${n} 天`,
  }));

  // 載入最新批次（進頁 / 手動重整）。後端未啟動時靜默 fallback。
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
    trackEvent("view", { payload: { scope: "push_page" } });
    void load();
  }, [load]);

  const onGenerate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setError(false);
    try {
      const result = await runPush({ limit, minScore, lookbackDays });
      setItems(result.items);
      setUnread(result.unread);
      setLastRun({ created: result.created, skipped: result.skipped });
    } catch {
      setError(true);
    } finally {
      setGenerating(false);
    }
  }, [generating, limit, minScore, lookbackDays]);

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
      payload: { scope: "push_page", source: it.source ?? undefined },
    });
    if (it.tenderId != null) {
      window.location.href = `/tenders/${it.tenderId}`;
    }
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title={t("navPush")}
        subtitle={t("pushPageSub")}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw
              size={14}
              className={loading ? "animate-spin" : undefined}
            />
            {t("pushRefresh")}
          </Button>
        }
      />

      {/* 產生設定 */}
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>{t("pushSettings")}</CardTitle>
            <CardDescription className="mt-0.5">
              {t("pushSettingsHint")}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t("pushLimitLabel")}>
              <Select
                value={String(limit)}
                onValueChange={(v) => setLimit(Number(v))}
                options={limitOptions}
              />
            </Field>
            <Field label={t("pushMinScoreLabel")}>
              <Select
                value={String(minScore)}
                onValueChange={(v) => setMinScore(Number(v))}
                options={minScoreOptions}
              />
            </Field>
            <Field label={t("pushLookbackLabel")}>
              <Select
                value={String(lookbackDays)}
                onValueChange={(v) => setLookbackDays(Number(v))}
                options={lookbackOptions}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void onGenerate()} disabled={generating}>
              {generating ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  {t("pushGenerating")}
                </>
              ) : (
                <>
                  <Sparkles size={15} />
                  {t("pushGenerate")}
                </>
              )}
            </Button>
            {lastRun && (
              <span className="text-[12px] text-ink-muted">
                {t("pushCreated")} {lastRun.created} · {t("pushSkipped")}{" "}
                {lastRun.skipped}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 最新批次預覽 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold tracking-tight text-ink">
            {t("pushLatestBatch")}
            {items.length > 0 && (
              <span className="ml-1.5 text-[12px] font-normal text-ink-dim">
                {items.length}
                {t("pushUnit")}
              </span>
            )}
          </h2>
          {items.length > 0 && (
            <button
              onClick={() => void onMarkAllRead()}
              disabled={unread === 0}
              className="text-[12px] font-medium text-primary transition-colors hover:text-primary/80 disabled:cursor-default disabled:text-ink-dim"
            >
              {unread === 0 ? t("pushAllRead") : t("pushMarkAllRead")}
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-ink-muted">
            <Loader2 size={15} className="animate-spin" />
            {t("pushGenerating")}
          </div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-[13px] leading-relaxed text-ink-muted">
                {error ? t("pushError") : t("pushEmpty")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
      </section>
    </div>
  );
}

// 設定欄位：label + 控制項（label 包住 Select 內的原生 <select>，點 label 即聚焦）。
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-muted">{label}</span>
      {children}
    </label>
  );
}
