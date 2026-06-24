import { useEffect, useMemo, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { useApp } from "@/store/app-context";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  fetchKeywordCandidates,
  postKeywordOverride,
  type KeywordCandidates,
} from "@/lib/api";
import { trackEvent, trackEventAwait } from "@/lib/events";
import { cn } from "@/lib/utils";

// 速覽配對「判斷原因」表單（需求 B/C/D）。
// - B：每次 ✓/⭐/✗ 都跳此對話框，可一鍵略過（不記錄）。
// - C：把相關關鍵字拆「詞（jieba 斷詞）／字（CJK 單字）」供本人選取，標註「因哪些
//   關鍵字而做此判斷」；確認後寫入學習關鍵字管線（POST /me/keywords）＋送一筆事件。
// - D：確認走 awaitable 寫入，成功/失敗以對話框內就地狀態回饋（無 toast 系統）。
//
// 紅線（negative-keywords-human-only）：略過（pass）時，系統建議的迴避詞僅「預選＋附
// 理由」，唯有本人按下「確認並記錄」才會以 kind=negative 真正歸入負向偏好；一鍵略過
// 或關閉對話框都不會寫入任何負權重。
export type SwipeDecisionAction = "accept" | "pass" | "save";
type SaveStatus = "idle" | "saving" | "saved" | "error";

function KwChip({
  term,
  selected,
  negative,
  recommended,
  inTitle,
  hoverTitle,
  onToggle,
}: {
  term: string;
  selected: boolean;
  negative: boolean;
  recommended: boolean;
  inTitle: boolean;
  hoverTitle?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      title={hoverTitle}
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
      {recommended && <Sparkles size={11} className="opacity-70" aria-hidden />}
    </button>
  );
}

export function SwipeDecisionDialog({
  action,
  tenderId,
  title,
  onResolved,
}: {
  action: SwipeDecisionAction;
  tenderId: string;
  title: string;
  /**
   * 確認成功／一鍵略過後皆呼叫；由呼叫端負責關閉對話框並執行滑卡副作用。
   * 「確認並記錄」會帶回 { reason }（pass 時供呼叫端寫入淘汰理由）；一鍵略過為 undefined。
   */
  onResolved: (result?: { reason?: string }) => void;
}) {
  const { t } = useApp();
  const negative = action === "pass";

  const [cand, setCand] = useState<KeywordCandidates | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<SaveStatus>("idle");

  // 載入字／詞候選（唯讀；後端不寫權重）。
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetchKeywordCandidates(tenderId, ctrl.signal)
      .then((c) => setCand(c))
      .catch(() => setCand(null))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [tenderId]);

  // 預選：accept/save 預選本人正向命中詞；pass 預選系統建議迴避詞（需本人確認才生效）。
  useEffect(() => {
    if (!cand) return;
    const pre = negative
      ? cand.recommendedNegative.map((n) => n.term)
      : cand.positiveHits;
    setSelected(new Set(pre));
  }, [cand, negative]);

  const recommendedTerms = useMemo(
    () => new Set((cand?.recommendedNegative ?? []).map((n) => n.term)),
    [cand],
  );
  const reasonByTerm = useMemo(() => {
    const m = new Map<string, string>();
    (cand?.recommendedNegative ?? []).forEach((n) => m.set(n.term, n.reason));
    return m;
  }, [cand]);

  const heading = negative
    ? t("swipeReasonTitlePass")
    : action === "save"
      ? t("swipeReasonTitleSave")
      : t("swipeReasonTitleInterested");

  function toggle(term: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });
  }

  function splitSelected(): { words: string[]; chars: string[] } {
    if (!cand) return { words: [], chars: [] };
    const wordSet = new Set(cand.words.map((w) => w.term));
    const words: string[] = [];
    const chars: string[] = [];
    selected.forEach((term) => {
      if (wordSet.has(term)) words.push(term);
      else chars.push(term);
    });
    return { words, chars };
  }

  // 確認並記錄（D）：寫入學習關鍵字管線＋送一筆 awaitable 事件，就地回饋成敗。
  async function handleConfirm() {
    if (status === "saving" || status === "saved") return;
    setStatus("saving");
    const { words, chars } = splitSelected();
    const kind = negative ? "negative" : "positive";
    try {
      // 逐詞寫入偏好（accept/save→positive；pass→negative，紅線：本人確認才歸負分）。
      await Promise.all(
        [...selected].map((term) => postKeywordOverride(term, kind, "add")),
      );
      const ok = await trackEventAwait("view", {
        tenderId,
        payload: {
          scope: "swipe",
          action,
          reason: reason.trim(),
          selected_words: words,
          selected_chars: chars,
        },
      });
      if (!ok) throw new Error("event not recorded");
      setStatus("saved");
      // 帶回理由：pass 時呼叫端據此 reclassify→skipped 並寫入淘汰理由（接入決策回顧）。
      window.setTimeout(() => onResolved({ reason: reason.trim() }), 420);
    } catch {
      setStatus("error");
    }
  }

  // 一鍵略過（不記錄關鍵字）：仍送一筆基本滑卡訊號（fire-and-forget），立即收尾。
  function handleSkip() {
    if (status === "saving" || status === "saved") return;
    trackEvent("view", {
      tenderId,
      payload: {
        scope: "swipe",
        action,
        reason: "",
        selected_words: [],
        selected_chars: [],
      },
    });
    onResolved();
  }

  const hasKeywords =
    !!cand && (cand.words.length > 0 || cand.chars.length > 0);

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <div className="text-[12px]" aria-live="polite">
        {status === "saved" && (
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
          onClick={handleSkip}
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
      onClose={handleSkip}
      title={heading}
      footer={footer}
      width="sm:max-w-lg"
    >
      <div className="space-y-5">
        <p className="line-clamp-2 text-[13px] text-ink-muted">{title}</p>

        <div>
          <label
            htmlFor="swipe-reason"
            className="mb-1.5 block text-[12px] font-medium text-ink-muted"
          >
            {t("swipeReasonLabel")}
          </label>
          <textarea
            id="swipe-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("swipeReasonPh")}
            rows={2}
            className="w-full resize-none rounded-md border border-input bg-surface-1 px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-ink-dim focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/25"
          />
        </div>

        <p className="text-[12px] leading-relaxed text-ink-dim">
          {negative ? t("swipeKwHintNegative") : t("swipeKwHintPositive")}
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
                      recommended={recommendedTerms.has(w.term)}
                      inTitle={w.inTitle}
                      hoverTitle={
                        reasonByTerm.get(w.term) ||
                        (w.inTitle ? t("swipeKwInTitle") : undefined)
                      }
                      onToggle={() => toggle(w.term)}
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
                      recommended={recommendedTerms.has(c.term)}
                      inTitle={c.inTitle}
                      hoverTitle={
                        reasonByTerm.get(c.term) ||
                        (c.inTitle ? t("swipeKwInTitle") : undefined)
                      }
                      onToggle={() => toggle(c.term)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {negative && recommendedTerms.size > 0 && (
          <p className="flex items-center gap-1 text-[11px] text-ink-dim">
            <Sparkles size={11} aria-hidden />
            <span>
              {t("swipeKwSuggested")} · {t("swipeKwSuggestedTip")}
            </span>
          </p>
        )}
      </div>
    </Dialog>
  );
}
