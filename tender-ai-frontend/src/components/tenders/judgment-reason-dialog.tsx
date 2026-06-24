import { useEffect, useState } from "react";
import { Check, Sparkles, ThumbsUp, ThumbsDown, Star } from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fetchKeywordCandidates, type KeywordCandidates } from "@/lib/api";
import type { Verdict } from "@/types/domain";
import type { Lang } from "@/i18n/strings";
import { cn } from "@/lib/utils";

// 三分判斷原因表單（需求 c/d/e/h）。
// - d：✓ 可行 / ✗ 不可行 / ⭐ 精選 三者語意明確區分（不同標題、副述、配色）。
// - c/e：統一原則——任一判斷都跳此表單，要求「大致原因」（快速 chips + 選填文字）。
// - h：確認後走 store.judge() → POST /tenders/{id}/evaluate，後端即時把 Layer B 併入
//      Layer C；回傳的 learning 摘要就地顯示「已即時影響推播/演算法」。
//
// 紅線覆寫（negative-keywords-human-only，alex@hqdesign.tw 於 2026-06-24 知情覆寫）：
// 「不可行」會即時寫入團隊負權重；保留 append-only / consent-aware / 具名 / 可回溯。
type SaveStatus = "idle" | "saving" | "saved" | "error";

// 快速原因 chips（依判斷別 × 語言）。非 t() 因 t() 僅取字串值鍵。
const QUICK_CHIPS: Record<Verdict, Record<Lang, string[]>> = {
  feasible: {
    zh: [
      "符合本業",
      "預算合適",
      "技術可行",
      "資格符合",
      "時程允許",
      "客戶關係",
    ],
    en: [
      "Core business",
      "Budget fits",
      "Technically doable",
      "We qualify",
      "Timeline OK",
      "Client relation",
    ],
  },
  featured: {
    zh: ["策略重點", "利潤高", "指標客戶", "可複製案型", "競爭少", "強烈推薦"],
    en: [
      "Strategic",
      "High margin",
      "Key client",
      "Repeatable",
      "Low competition",
      "Strongly recommend",
    ],
  },
  infeasible: {
    zh: ["非本業", "預算過低", "資格不符", "時程太趕", "風險過高", "競爭過激"],
    en: [
      "Out of scope",
      "Budget too low",
      "Don't qualify",
      "Too rushed",
      "Too risky",
      "Over-competitive",
    ],
  },
};

function KwChip({
  term,
  selected,
  negative,
  inTitle,
  onToggle,
}: {
  term: string;
  selected: boolean;
  negative: boolean;
  inTitle: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
        selected
          ? negative
            ? "border-danger/40 bg-danger/12 text-danger"
            : "border-signal/40 bg-signal/12 text-signal"
          : "border-border bg-card text-ink-muted hover:border-ink-dim/50 hover:text-ink",
      )}
    >
      {selected && <Check size={12} aria-hidden />}
      <span className={cn(inTitle && "font-semibold")}>{term}</span>
    </button>
  );
}

const VERDICT_META: Record<
  Verdict,
  {
    icon: typeof ThumbsUp;
    titleKey:
      | "judgeTitleFeasible"
      | "judgeTitleInfeasible"
      | "judgeTitleFeatured";
    subKey: "judgeSubFeasible" | "judgeSubInfeasible" | "judgeSubFeatured";
    accent: string;
    chip: string;
  }
> = {
  feasible: {
    icon: ThumbsUp,
    titleKey: "judgeTitleFeasible",
    subKey: "judgeSubFeasible",
    accent: "text-success",
    chip: "border-success/40 bg-success/10 text-success",
  },
  featured: {
    icon: Star,
    titleKey: "judgeTitleFeatured",
    subKey: "judgeSubFeatured",
    accent: "text-priority",
    chip: "border-priority/40 bg-priority/10 text-priority",
  },
  infeasible: {
    icon: ThumbsDown,
    titleKey: "judgeTitleInfeasible",
    subKey: "judgeSubInfeasible",
    accent: "text-danger",
    chip: "border-danger/40 bg-danger/10 text-danger",
  },
};

export function JudgmentReasonDialog({
  verdict,
  tenderId,
  title,
  onResolved,
}: {
  verdict: Verdict;
  tenderId: string;
  title: string;
  /** 確認成功／一鍵略過後皆呼叫；由呼叫端負責關閉對話框。 */
  onResolved: () => void;
}) {
  const { t, lang } = useApp();
  const { judge } = useAppData();
  const negative = verdict === "infeasible";
  const meta = VERDICT_META[verdict];
  const Icon = meta.icon;

  const [cand, setCand] = useState<KeywordCandidates | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");
  const [chips, setChips] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [learnedNote, setLearnedNote] = useState<string | null>(null);

  // 載入字／詞候選（唯讀；不寫權重）。
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetchKeywordCandidates(tenderId, ctrl.signal)
      .then((c) => setCand(c))
      .catch(() => setCand(null))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [tenderId]);

  // 正向判斷預選本人正向命中詞；不可行不預選（負分由本人逐一點選）。
  useEffect(() => {
    if (!cand) return;
    setSelected(new Set(negative ? [] : cand.positiveHits));
  }, [cand, negative]);

  const quickChips = QUICK_CHIPS[verdict][lang];

  function toggleChip(label: string) {
    setChips((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function toggleKw(term: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });
  }

  // 合併「大致原因」：快速 chips ＋ 選填文字 ＋ 標記關鍵字。
  function composeRationale(): string {
    const parts: string[] = [];
    if (chips.size > 0) parts.push([...chips].join("、"));
    if (reason.trim()) parts.push(reason.trim());
    if (selected.size > 0) parts.push(`#${[...selected].join(" #")}`);
    return parts.join(" — ");
  }

  const hasKeywords =
    !!cand && (cand.words.length > 0 || cand.chars.length > 0);

  async function handleConfirm() {
    if (status === "saving" || status === "saved") return;
    setStatus("saving");
    try {
      const result = await judge(tenderId, verdict, composeRationale(), [
        ...chips,
      ]);
      const added = result?.learning?.keywordsAdded ?? 0;
      const updated = result?.learning?.keywordsUpdated ?? 0;
      if (result?.learning && (added > 0 || updated > 0)) {
        setLearnedNote(
          negative ? t("judgeLearnedNegative") : t("judgeLearnedPositive"),
        );
      }
      setStatus("saved");
      window.setTimeout(onResolved, learnedNote ? 900 : 520);
    } catch {
      setStatus("error");
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <div className="text-[12px]" aria-live="polite">
        {status === "saved" && learnedNote && (
          <span className={cn("flex items-center gap-1", meta.accent)}>
            <Sparkles size={12} aria-hidden /> {learnedNote}
          </span>
        )}
        {status === "saved" && !learnedNote && (
          <span className="text-success">{t("swipeDecisionSaved")}</span>
        )}
        {status === "error" && (
          <span className="text-danger">{t("swipeDecisionError")}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onResolved}
          disabled={status === "saving" || status === "saved"}
        >
          {t("swipeDecisionSkip")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleConfirm}
          disabled={status === "saving" || status === "saved"}
        >
          {status === "saving"
            ? t("swipeDecisionSaving")
            : status === "error"
              ? t("swipeDecisionRetry")
              : t("swipeDecisionConfirm")}
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog
      open
      onClose={onResolved}
      title={t(meta.titleKey)}
      footer={footer}
      width="sm:max-w-lg"
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2",
              meta.accent,
            )}
          >
            <Icon size={18} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="line-clamp-2 text-[13px] font-medium text-ink">
              {title}
            </p>
            <p
              className={cn("mt-0.5 text-[12px] leading-relaxed", meta.accent)}
            >
              {t(meta.subKey)}
            </p>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[12px] font-medium text-ink-muted">
            {t("judgeChipsLabel")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {quickChips.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleChip(label)}
                aria-pressed={chips.has(label)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                  chips.has(label)
                    ? meta.chip
                    : "border-border bg-card text-ink-muted hover:border-ink-dim/50 hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="judge-reason"
            className="mb-1.5 block text-[12px] font-medium text-ink-muted"
          >
            {t("judgeReasonLabel")}
          </label>
          <textarea
            id="judge-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("judgeReasonPh")}
            rows={2}
            className="w-full resize-none rounded-md border border-input bg-surface-1 px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-ink-dim focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/25"
          />
        </div>

        <div>
          <p className="mb-2 text-[12px] leading-relaxed text-ink-dim">
            {t("judgeKwHint")}
          </p>
          {loading ? (
            <p className="text-[13px] text-ink-dim">{t("swipeKwLoading")}</p>
          ) : !hasKeywords ? (
            <p className="text-[13px] text-ink-dim">{t("swipeKwNone")}</p>
          ) : (
            <div className="space-y-4">
              {cand!.words.length > 0 && (
                <section>
                  <div className="mb-2 text-[11px] font-medium text-ink-dim">
                    {t("swipeKwWords")}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {cand!.words.map((w) => (
                      <KwChip
                        key={`w-${w.term}`}
                        term={w.term}
                        selected={selected.has(w.term)}
                        negative={negative}
                        inTitle={w.inTitle}
                        onToggle={() => toggleKw(w.term)}
                      />
                    ))}
                  </div>
                </section>
              )}
              {cand!.chars.length > 0 && (
                <section>
                  <div className="mb-2 text-[11px] font-medium text-ink-dim">
                    {t("swipeKwChars")}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {cand!.chars.map((c) => (
                      <KwChip
                        key={`c-${c.term}`}
                        term={c.term}
                        selected={selected.has(c.term)}
                        negative={negative}
                        inTitle={c.inTitle}
                        onToggle={() => toggleKw(c.term)}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
