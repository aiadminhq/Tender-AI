import { useCallback, useEffect, useState } from "react";
import { Check, CircleSlash, Loader2, Plus, RefreshCw } from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  fetchAbandonedKeywordCandidates,
  postKeywordOverride,
  type AbandonedRootCandidate,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// 規則頁「建議迴避字根」（P3 規則字根連動）。
// 由本人**實際淘汰**（速覽 ✗／狀態＝放棄）的標案標題，後端聚合出常見字根／詞候選（唯讀）。
// 紅線（negative-keywords-human-only）：候選僅為附證據的建議；唯有本人按「加入迴避」才會
// 經 postKeywordOverride(kind="negative") 真正歸負分，同步反映到本地「避免關鍵字」清單。
// 系統永不自動扣分。

type AddState = "idle" | "saving" | "done" | "error";

function RootChip({
  cand,
  state,
  inAvoid,
  onAdd,
  labels,
}: {
  cand: AbandonedRootCandidate;
  state: AddState;
  inAvoid: boolean;
  onAdd: () => void;
  labels: {
    add: string;
    added: string;
    countTip: string;
    word: string;
    root: string;
  };
}) {
  const done = state === "done" || inAvoid;
  const kindLabel = cand.kind === "word" ? labels.word : labels.root;
  const tip = cand.sampleTitles.length
    ? cand.sampleTitles.join("\n")
    : undefined;

  return (
    <div
      title={tip}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition-colors",
        done
          ? "border-tier-mid/40 bg-tier-mid/10 text-tier-mid"
          : "border-border bg-card text-ink",
      )}
    >
      <span className="font-medium">{cand.term}</span>
      <span className="text-[10px] text-ink-dim">{kindLabel}</span>
      <span
        title={labels.countTip}
        className="tnum rounded-full bg-surface-1 px-1.5 text-[10px] text-ink-dim"
      >
        {cand.count}
      </span>
      {done ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-tier-mid">
          <Check size={12} aria-hidden />
          {labels.added}
        </span>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={state === "saving"}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium transition-colors",
            "text-ink-dim hover:bg-tier-mid/12 hover:text-tier-mid",
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
  );
}

/**
 * 建議迴避字根區塊（掛在規則頁三清單編輯器下方）。純內容元件，無 props。
 * 自抓候選；後端不可達時靜默退化為提示（不阻斷規則頁其他功能）。
 */
export function AbandonedRoots() {
  const { t } = useApp();
  const { avoidKeywords, hardExclude, focusKeywords, addKeywords } =
    useAppData();

  const [cands, setCands] = useState<AbandonedRootCandidate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [states, setStates] = useState<Record<string, AddState>>({});

  // 已在任一本地清單者不重複建議（與後端「排除已迴避詞」一致，並避免互斥清單衝突）。
  const known = new Set([...avoidKeywords, ...hardExclude, ...focusKeywords]);

  // 純抓取：只在非同步回呼裡 setState（避免在 effect 內同步 setState 觸發級聯渲染）。
  const runFetch = useCallback((signal?: AbortSignal) => {
    fetchAbandonedKeywordCandidates({ minCount: 2, limit: 40, signal })
      .then((d) => setCands(d.candidates))
      .catch(() => {
        if (!signal?.aborted) {
          setError(true);
          setCands([]);
        }
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, []);

  // 重新整理（按鈕事件，非 effect）：可安全同步重置載入／錯誤狀態。
  const refresh = useCallback(() => {
    setLoading(true);
    setError(false);
    runFetch();
  }, [runFetch]);

  // 首次掛載：loading／error 初值已為 true／false，effect 只需發出抓取。
  useEffect(() => {
    const ctrl = new AbortController();
    runFetch(ctrl.signal);
    return () => ctrl.abort();
  }, [runFetch]);

  // 加入迴避（紅線：本人確認才歸負分）：先寫後端 kind=negative，再反映本地 avoid 清單。
  async function add(term: string) {
    setStates((s) => ({ ...s, [term]: "saving" }));
    try {
      await postKeywordOverride(term, "negative", "add");
      addKeywords("avoid", [term]);
      setStates((s) => ({ ...s, [term]: "done" }));
    } catch {
      setStates((s) => ({ ...s, [term]: "error" }));
    }
  }

  const visible = (cands ?? []).filter(
    (c) => states[c.term] === "done" || !known.has(c.term),
  );

  const chipLabels = {
    add: t("rulesAbandonedAdd"),
    added: t("rulesAbandonedAdded"),
    countTip: t("rulesAbandonedCountTip"),
    word: t("rulesKindWord"),
    root: t("rulesKindRoot"),
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-tier-mid/12 text-tier-mid">
          <CircleSlash size={15} />
        </span>
        <h3 className="text-[14px] font-semibold text-ink">
          {t("rulesAbandonedTitle")}
        </h3>
        {visible.length > 0 && (
          <Badge variant="muted" className="tnum">
            {visible.length}
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw size={13} className={cn(loading && "animate-spin")} />
          {t("rulesAbandonedRefresh")}
        </Button>
      </div>

      <p className="text-[12px] leading-relaxed text-ink-dim">
        {t("rulesAbandonedDesc")}
      </p>

      {loading ? (
        <p className="flex items-center gap-2 text-[13px] text-ink-dim">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          {t("rulesAbandonedLoading")}
        </p>
      ) : visible.length === 0 ? (
        <p className="text-[13px] text-ink-dim">
          {error ? t("rulesAbandonedError") : t("rulesAbandonedEmpty")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {visible.map((c) => (
            <RootChip
              key={c.term}
              cand={c}
              state={states[c.term] ?? "idle"}
              inAvoid={avoidKeywords.includes(c.term)}
              onAdd={() => add(c.term)}
              labels={chipLabels}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
