import { useState } from "react";
import { Brain, Minus, Plus, TrendingDown, TrendingUp } from "lucide-react";
import type { Lang, TextKey } from "@/i18n/strings";
import type {
  CriteriaProfile,
  ReasonCode,
  ReasonDirection,
  ReasonVerdict,
  TenderReasoning,
} from "@/types/domain";
import { Badge } from "@/components/ui/badge";
import { SectionLabel } from "@/components/tenders/detail-bits";
import { postKeywordOverride } from "@/lib/api";
import { cn } from "@/lib/utils";

// 三區塊對應後端覆寫 kind（見 app/schemas/reasoning.py ManualKeywordIn）。
type KwKind = "positive" | "negative" | "engaged";

// SL3「為什麼·推理」面板：把後端可解釋推理（fit + reason codes + 判準輪廓）
// 視覺化。回應願景「推理使用者衡量可中標的標準是基於什麼因素與關係」。
// 僅呈現 Layer A 公開欄位與聚合統計，無個別評語原文／人名。

const VERDICT_KEY: Record<ReasonVerdict, TextKey> = {
  strong: "verdictStrong",
  consider: "verdictConsider",
  weak: "verdictWeak",
};

// 結論色：高吻合綠 / 值得評估琥珀 / 落差紅。
const VERDICT_TONE: Record<ReasonVerdict, string> = {
  strong: "text-tier-high",
  consider: "text-tier-mid",
  weak: "text-tier-low",
};
const VERDICT_BAR: Record<ReasonVerdict, string> = {
  strong: "bg-tier-high",
  consider: "bg-tier-mid",
  weak: "bg-tier-low",
};

const DIR_TONE: Record<ReasonDirection, string> = {
  positive: "text-tier-high",
  negative: "text-tier-low",
  neutral: "text-ink-dim",
};

function DirIcon({ direction }: { direction: ReasonDirection }) {
  const Icon =
    direction === "positive"
      ? TrendingUp
      : direction === "negative"
        ? TrendingDown
        : Minus;
  return <Icon size={14} className={cn("shrink-0", DIR_TONE[direction])} />;
}

/** 單條推理：方向圖示 + 因素名/取值 + 帶符號影響 + 一句話證據。 */
function ReasonRow({ r }: { r: ReasonCode }) {
  // impact 約 -1..1，換算為「fit 點數」近似值；中性（≈0）不顯示數字。
  const pts = Math.round(r.impact * 100);
  const showPts = r.direction !== "neutral" && pts !== 0;
  return (
    <li className="flex gap-2.5">
      <div className="mt-0.5">
        <DirIcon direction={r.direction} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-ink">
            {r.label}
            {r.value && (
              <span className="ml-1 text-ink-muted">· {r.value}</span>
            )}
          </span>
          {showPts && (
            <span
              className={cn(
                "tnum shrink-0 text-[11px] font-semibold",
                DIR_TONE[r.direction],
              )}
            >
              {pts > 0 ? "+" : ""}
              {pts}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
          {r.evidence}
        </p>
      </div>
    </li>
  );
}

export function ReasoningPanel({
  reasoning,
  lang,
  t,
  onProfileChange,
}: {
  reasoning: TenderReasoning;
  lang: Lang;
  t: (k: TextKey) => string;
  // 手動覆寫關鍵字後，回傳合併後的最新判準輪廓給上層更新（顯示用；計分另計）。
  onProfileChange?: (profile: CriteriaProfile) => void;
}) {
  const { criteriaFit, verdict, headline, reasons, profile } = reasoning;
  // 進行中的覆寫（term#kind），用來鎖住該 tag／輸入避免重複送出。
  const [pending, setPending] = useState<string | null>(null);

  // 互動：手動 add／remove 一個關鍵字 → 後端回傳合併後輪廓 → 通知上層。
  // 唯讀（未提供 onProfileChange）時不掛任何互動，維持原純展示行為。
  const interactive = typeof onProfileChange === "function";
  async function mutate(term: string, kind: KwKind, action: "add" | "remove") {
    const trimmed = term.trim();
    if (!trimmed || !onProfileChange) return;
    const key = `${trimmed}#${kind}#${action}`;
    setPending(key);
    try {
      const next = await postKeywordOverride(trimmed, kind, action);
      onProfileChange(next);
    } catch {
      /* 失敗不就地回滾畫面；下次重整或重試 */
    } finally {
      setPending((p) => (p === key ? null : p));
    }
  }
  const confKey: TextKey =
    profile.confidence === "high"
      ? "confHigh"
      : profile.confidence === "medium"
        ? "confMedium"
        : "confLow";

  const budgetRange =
    profile.budgetFeasibleMin != null && profile.budgetFeasibleMax != null
      ? `${profile.budgetFeasibleMin}–${profile.budgetFeasibleMax} ${lang === "en" ? "(×10k)" : "萬"}`
      : null;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-1.5">
        <Brain size={14} className="text-signal" />
        <SectionLabel>{t("reasoningTitle")}</SectionLabel>
      </div>

      {/* fit 分數 + 結論 + 一句話標題 */}
      <div className="flex items-start gap-4">
        <div className="shrink-0 text-center">
          <div
            className={cn(
              "tnum text-[34px] font-semibold leading-none",
              VERDICT_TONE[verdict],
            )}
          >
            {criteriaFit}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-dim">
            {t("reasoningFit")}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("text-[13px] font-medium", VERDICT_TONE[verdict])}>
            {t(VERDICT_KEY[verdict])}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            {headline}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn("h-full rounded-full", VERDICT_BAR[verdict])}
              style={{ width: `${Math.max(3, Math.min(100, criteriaFit))}%` }}
            />
          </div>
        </div>
      </div>

      {/* 逐條判斷依據（依 |impact| 由大到小，中性提示殿後） */}
      {reasons.length > 0 && (
        <div className="mt-4">
          <SectionLabel>{t("reasoningWhy")}</SectionLabel>
          <ul className="space-y-2.5">
            {reasons.map((r, i) => (
              <ReasonRow key={`${r.factor}-${i}`} r={r} />
            ))}
          </ul>
        </div>
      )}

      {/* 判準輪廓快照：系統已學到的承標標準 */}
      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-ink-muted">
            {t("reasoningProfile")}
          </span>
          <Badge variant="outline" className={cn(VERDICT_TONE.consider)}>
            {t(confKey)}
          </Badge>
        </div>
        <p className="tnum text-[11px] text-ink-dim">
          {profile.nEvaluations} {t("reasoningBasis")} · {profile.nEvents}{" "}
          {t("reasoningEvents")}
        </p>

        {/* 互動模式：三區塊恆顯示（含「+ 新增」框）；唯讀模式維持原本「有才顯示」。
            迴避(neg)＝「負分一律由人手動給」的唯一合規路徑（系統不得自動產生負分）。 */}
        {(interactive || profile.engagedCategories.length > 0) && (
          <ProfileTagRow
            label={t("reasoningEngaged")}
            tags={profile.engagedCategories}
            tone="signal"
            kind="engaged"
            addLabel={t("reasoningKwAddEngaged")}
            t={t}
            pending={pending}
            onAdd={interactive ? mutate : undefined}
            onRemove={interactive ? mutate : undefined}
          />
        )}
        {(interactive || profile.topKeywordsPositive.length > 0) && (
          <ProfileTagRow
            label={t("reasoningKwPos")}
            tags={profile.topKeywordsPositive}
            tone="pos"
            kind="positive"
            addLabel={t("reasoningKwAddPos")}
            t={t}
            pending={pending}
            onAdd={interactive ? mutate : undefined}
            onRemove={interactive ? mutate : undefined}
          />
        )}
        {(interactive || profile.topKeywordsNegative.length > 0) && (
          <ProfileTagRow
            label={t("reasoningKwNeg")}
            tags={profile.topKeywordsNegative}
            tone="neg"
            kind="negative"
            addLabel={t("reasoningKwAddNeg")}
            t={t}
            pending={pending}
            onAdd={interactive ? mutate : undefined}
            onRemove={interactive ? mutate : undefined}
          />
        )}
        {budgetRange && (
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-ink-dim">
              {t("reasoningBudgetRange")}
            </span>
            <span className="tnum text-[11px] font-medium text-ink">
              {budgetRange}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function ProfileTagRow({
  label,
  tags,
  tone,
  kind,
  addLabel,
  t,
  pending,
  onAdd,
  onRemove,
}: {
  label: string;
  tags: string[];
  tone: "signal" | "pos" | "neg";
  kind: KwKind;
  addLabel: string;
  t: (k: TextKey) => string;
  pending: string | null;
  onAdd?: (term: string, kind: KwKind, action: "add" | "remove") => void;
  onRemove?: (term: string, kind: KwKind, action: "add" | "remove") => void;
}) {
  const cls =
    tone === "pos"
      ? "border-tier-high/40 text-tier-high"
      : tone === "neg"
        ? "border-tier-low/40 text-tier-low"
        : "border-signal/40 text-signal";
  const interactive = Boolean(onAdd || onRemove);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  function submitAdd() {
    const term = draft.trim();
    if (term && onAdd) onAdd(term, kind, "add");
    setDraft("");
    setAdding(false);
  }

  return (
    <div className="mt-2">
      <div className="mb-1 text-[11px] text-ink-dim">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tg) => {
          const busy = pending === `${tg}#${kind}#remove`;
          return (
            <span
              key={tg}
              className={cn(
                "group inline-flex items-center gap-1 rounded-full border bg-surface-1 px-2 py-0.5 text-[11px]",
                cls,
                busy && "opacity-50",
              )}
            >
              {tg}
              {onRemove && (
                <button
                  type="button"
                  aria-label={`${t("reasoningKwRemove")}：${tg}`}
                  title={t("reasoningKwRemove")}
                  disabled={busy}
                  onClick={() => onRemove(tg, kind, "remove")}
                  className={cn(
                    "grid size-3.5 place-items-center rounded-full opacity-0 transition",
                    "hover:bg-current/10 focus-visible:opacity-100 focus-visible:outline-none",
                    "group-hover:opacity-70 hover:opacity-100",
                  )}
                >
                  <Minus size={11} className="shrink-0" />
                </button>
              )}
            </span>
          );
        })}

        {interactive &&
          (adding ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={submitAdd}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitAdd();
                } else if (e.key === "Escape") {
                  setDraft("");
                  setAdding(false);
                }
              }}
              placeholder={t("reasoningKwHint")}
              className={cn(
                "h-[22px] w-36 rounded-full border bg-surface-1 px-2 text-[11px]",
                "text-ink placeholder:text-ink-dim/70",
                "border-signal/50 outline-none focus-visible:ring-1 focus-visible:ring-signal/40",
              )}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              title={addLabel}
              aria-label={addLabel}
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full border border-dashed",
                "border-border bg-transparent px-2 py-0.5 text-[11px] text-ink-dim",
                "transition hover:border-ink-dim/60 hover:text-ink-muted",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal/40",
              )}
            >
              <Plus size={11} className="shrink-0" />
              {t("reasoningKwAdd")}
            </button>
          ))}
      </div>
    </div>
  );
}
