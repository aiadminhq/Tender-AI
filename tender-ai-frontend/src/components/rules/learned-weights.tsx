import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Plus, Scale } from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { fetchReasoningProfile, postKeywordOverride } from "@/lib/api";
import type { CategorySignal, CriteriaProfile } from "@/types/domain";
import type { TextKey } from "@/i18n/strings";
import { cn } from "@/lib/utils";

// 規則頁「學到的權重排序」（取代舊規則頁的擴充區塊）。
// 資料源＝GET /reasoning/profile 的去識別化聚合（topKeywordsPositive/Negative 已依權重排序、
// 各維度 CategorySignal 帶真實 lift/support、預算可行區間、信心度）。後端無「每詞絕對數值
// 權重」端點，故關鍵字以「真實排名＋相對強度條」呈現（明確標示非絕對分數），維度則以真實
// lift 畫雙向長條——全程不捏造數字。
//
// 紅線（negative-keywords-human-only）：「迴避」清單只是團隊已學到的負向候選；唯有本人按
// 「加入避免」才會經 postKeywordOverride(kind="negative") 真正歸負分並落本地 avoid 清單。
// 本元件不自動把任何詞寫成負分（沿用 AbandonedRoots 既有合規路徑）。

type AddState = "idle" | "saving" | "done" | "error";
type Tone = "pos" | "neg";

/** 單列排序關鍵字：#rank + 詞 + 相對強度條（依排名遞減）+ 採納鈕／已在清單。 */
function RankRow({
  rank,
  term,
  intensity,
  tone,
  done,
  state,
  onAdd,
  labels,
}: {
  rank: number;
  term: string;
  intensity: number;
  tone: Tone;
  done: boolean;
  state: AddState;
  onAdd: () => void;
  labels: { add: string; inList: string };
}) {
  const barColor = tone === "pos" ? "bg-tier-high" : "bg-tier-low";
  return (
    <li className="flex items-center gap-2.5">
      <span className="tnum w-5 shrink-0 text-right text-[11px] text-ink-dim">
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[12px] font-medium text-ink">
            {term}
          </span>
          {done ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-tier-mid">
              <Check size={12} aria-hidden />
              {labels.inList}
            </span>
          ) : (
            <button
              type="button"
              onClick={onAdd}
              disabled={state === "saving"}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium transition-colors",
                tone === "pos"
                  ? "text-ink-dim hover:bg-tier-high/12 hover:text-tier-high"
                  : "text-ink-dim hover:bg-tier-low/12 hover:text-tier-low",
                state === "error" && "text-danger",
                state === "saving" && "opacity-60",
              )}
            >
              {state === "saving" ? (
                <Loader2 size={12} className="animate-spin" aria-hidden />
              ) : (
                <Plus size={12} aria-hidden />
              )}
              {labels.add}
            </button>
          )}
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className={cn("h-full rounded-full", barColor)}
            style={{ width: `${Math.round(intensity * 100)}%` }}
          />
        </div>
      </div>
    </li>
  );
}

/** 一維度的雙向 lift 長條：右正（tier-high）／左負（tier-low），寬度 = |lift| / maxAbs。 */
function SignalBars({
  title,
  signals,
  supportLabel,
}: {
  title: string;
  signals: CategorySignal[];
  supportLabel: string;
}) {
  if (!signals.length) return null;
  const top = [...signals]
    .sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift))
    .slice(0, 6);
  const maxAbs = Math.max(...top.map((s) => Math.abs(s.lift)), 0.0001);

  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-[11px] font-medium text-ink-muted">
        {title}
      </div>
      <ul className="space-y-1.5">
        {top.map((s) => {
          const w = Math.min(
            100,
            Math.round((Math.abs(s.lift) / maxAbs) * 100),
          );
          const positive = s.lift >= 0;
          return (
            <li
              key={s.value}
              className="flex items-center gap-2 text-[11px]"
              title={`lift ${(s.lift * 100).toFixed(0)} · ${s.feasible}/${s.feasible + s.infeasible}`}
            >
              <span className="w-16 shrink-0 truncate text-ink">{s.value}</span>
              <div className="flex flex-1 items-center">
                <div className="flex h-2 flex-1 justify-end">
                  {!positive && (
                    <div
                      className="h-full rounded-l-sm bg-tier-low"
                      style={{ width: `${w}%` }}
                    />
                  )}
                </div>
                <div className="h-3 w-px bg-border" />
                <div className="flex h-2 flex-1 justify-start">
                  {positive && (
                    <div
                      className="h-full rounded-r-sm bg-tier-high"
                      style={{ width: `${w}%` }}
                    />
                  )}
                </div>
              </div>
              <span className="tnum w-9 shrink-0 text-right text-ink-muted">
                {Math.round(s.pFeasible * 100)}%
              </span>
              <span className="tnum w-14 shrink-0 truncate text-right text-ink-dim">
                {s.support} {supportLabel}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 學到的權重排序區塊（掛在規則頁三清單編輯器與 AbandonedRoots 之間）。純內容元件，無 props。
 * 自抓 /reasoning/profile；後端不可達 → null → 顯示精簡提示（不阻斷頁面其他功能）。
 */
export function LearnedWeights() {
  const { t, lang } = useApp();
  const { focusKeywords, avoidKeywords, addKeywords } = useAppData();

  const [profile, setProfile] = useState<CriteriaProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [states, setStates] = useState<Record<string, AddState>>({});

  const runFetch = useCallback((signal?: AbortSignal) => {
    fetchReasoningProfile(signal)
      .then((p) => setProfile(p))
      .catch(() => {
        if (!signal?.aborted) setProfile(null);
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    runFetch(ctrl.signal);
    return () => ctrl.abort();
  }, [runFetch]);

  // 採納（紅線：本人確認才落清單）：先寫後端，再反映本地清單；用回傳輪廓刷新顯示。
  async function add(term: string, list: "focus" | "avoid", kind: Tone) {
    const key = `${list}:${term}`;
    setStates((s) => ({ ...s, [key]: "saving" }));
    try {
      const next = await postKeywordOverride(
        term,
        kind === "pos" ? "positive" : "negative",
        "add",
      );
      addKeywords(list, [term]);
      setProfile(next);
      setStates((s) => ({ ...s, [key]: "done" }));
    } catch {
      setStates((s) => ({ ...s, [key]: "error" }));
    }
  }

  const header = (
    <div className="flex items-center gap-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-signal/12 text-signal">
        <Scale size={15} />
      </span>
      <h3 className="text-[14px] font-semibold text-ink">{t("lwTitle")}</h3>
    </div>
  );

  if (loading) {
    return (
      <Card className="flex flex-col gap-3 p-4">
        {header}
        <p className="flex items-center gap-2 text-[13px] text-ink-dim">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          {t("lwLoading")}
        </p>
      </Card>
    );
  }

  if (!profile) {
    return (
      <Card className="flex flex-col gap-3 p-4">
        {header}
        <p className="text-[13px] text-ink-dim">{t("lwUnavailable")}</p>
      </Card>
    );
  }

  const p = profile;
  const hasData =
    p.topKeywordsPositive.length > 0 ||
    p.topKeywordsNegative.length > 0 ||
    p.categorySignals.length > 0 ||
    p.citySignals.length > 0 ||
    p.sourceSignals.length > 0 ||
    p.budgetFeasibleMin != null;

  if (!hasData) {
    return (
      <Card className="flex flex-col gap-3 p-4">
        {header}
        <p className="text-[13px] text-ink-dim">{t("lwEmpty")}</p>
      </Card>
    );
  }

  const confKey: TextKey =
    p.confidence === "high"
      ? "confHigh"
      : p.confidence === "medium"
        ? "confMedium"
        : "confLow";

  const unit = lang === "en" ? "(×10k)" : "萬";
  const budgetText =
    p.budgetFeasibleMin != null && p.budgetFeasibleMax != null
      ? p.budgetFeasibleMedian != null
        ? `${p.budgetFeasibleMin}–${p.budgetFeasibleMedian}–${p.budgetFeasibleMax} ${unit}`
        : `${p.budgetFeasibleMin}–${p.budgetFeasibleMax} ${unit}`
      : null;

  const rowLabels = { add: t("lwAddToFocus"), inList: t("lwInList") };
  const negRowLabels = { add: t("lwAddToAvoid"), inList: t("lwInList") };
  const supportLabel = t("lwSupport");

  const renderList = (
    terms: string[],
    tone: Tone,
    list: "focus" | "avoid",
    localList: string[],
    labels: { add: string; inList: string },
  ) => {
    const n = terms.length;
    return (
      <div className="min-w-0">
        <div className="mb-1.5 flex items-center gap-1.5">
          <span
            className={cn(
              "text-[12px] font-medium",
              tone === "pos" ? "text-tier-high" : "text-tier-low",
            )}
          >
            {tone === "pos" ? t("lwPosTitle") : t("lwNegTitle")}
          </span>
          {n > 0 && (
            <Badge variant="muted" className="tnum">
              {n}
            </Badge>
          )}
        </div>
        {n === 0 ? (
          <p className="text-[12px] text-ink-dim">{t("lwNoKeywords")}</p>
        ) : (
          <ul className="space-y-2">
            {terms.map((term, i) => {
              const key = `${list}:${term}`;
              return (
                <RankRow
                  key={term}
                  rank={i + 1}
                  term={term}
                  intensity={Math.max(0.12, (n - i) / n)}
                  tone={tone}
                  done={localList.includes(term) || states[key] === "done"}
                  state={states[key] ?? "idle"}
                  onAdd={() => add(term, list, tone)}
                  labels={labels}
                />
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  const hasSignals =
    p.categorySignals.length > 0 ||
    p.citySignals.length > 0 ||
    p.sourceSignals.length > 0;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {header}
        <Badge variant="outline" className="ml-auto text-tier-mid">
          {t(confKey)}
        </Badge>
      </div>

      <div className="flex flex-col gap-1">
        <p className="tnum text-[11px] text-ink-dim">
          {p.nEvaluations} {t("reasoningBasis")} · {p.nEvents}{" "}
          {t("reasoningEvents")}
        </p>
        {p.summary && (
          <p className="text-[12px] leading-relaxed text-ink-muted">
            {p.summary}
          </p>
        )}
        <p className="text-[11px] text-ink-dim">
          {t("lwRankHint")} · {t("lwConsentNote")}
        </p>
      </div>

      {/* 兩欄排序清單：偏好（加權）／迴避（降權）。排名由系統學習決定，人工只能採納／不可手排。 */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        {renderList(
          p.topKeywordsPositive,
          "pos",
          "focus",
          focusKeywords,
          rowLabels,
        )}
        {renderList(
          p.topKeywordsNegative,
          "neg",
          "avoid",
          avoidKeywords,
          negRowLabels,
        )}
      </div>

      {/* 各維度傾向：真實 lift 雙向長條（右正左負）。某維度無資料則該組不顯示。 */}
      {hasSignals && (
        <div className="border-t border-border pt-3">
          <div className="mb-2 text-[11px] font-medium text-ink-muted">
            {t("lwDimTitle")}
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-3">
            <SignalBars
              title={t("lwDimCategory")}
              signals={p.categorySignals}
              supportLabel={supportLabel}
            />
            <SignalBars
              title={t("lwDimCity")}
              signals={p.citySignals}
              supportLabel={supportLabel}
            />
            <SignalBars
              title={t("lwDimSource")}
              signals={p.sourceSignals}
              supportLabel={supportLabel}
            />
          </div>
        </div>
      )}

      {budgetText && (
        <div className="flex items-baseline justify-between gap-2 border-t border-border pt-3">
          <span className="text-[11px] text-ink-dim">
            {t("reasoningBudgetRange")}
          </span>
          <span className="tnum text-[12px] font-medium text-ink">
            {budgetText}
          </span>
        </div>
      )}
    </Card>
  );
}
