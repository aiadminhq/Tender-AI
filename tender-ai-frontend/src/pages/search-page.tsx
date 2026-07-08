import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { useApp } from "@/store/app-context";
import { STRINGS } from "@/i18n/strings";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TenderTable } from "@/components/tenders/tender-table";
import {
  searchSemantic,
  SemanticDegradedError,
  type SimilarTender,
} from "@/lib/api";
import { trackEvent } from "@/lib/events";

type Status = "idle" | "loading" | "done" | "error" | "degraded";

export function SearchPage() {
  const { t, lang } = useApp();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [hits, setHits] = useState<SimilarTender[]>([]);
  // 競態保護：只認最後一次送出的查詢結果。
  const reqId = useRef(0);

  const doSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;

    const id = ++reqId.current;
    setStatus("loading");
    try {
      const res = await searchSemantic(q, 30);
      if (id !== reqId.current) return; // 已有更新的查詢
      setHits(res.items);
      setStatus("done");
      // Layer B 行為訊號：語意搜尋（不帶 tenderId）。
      trackEvent("search", {
        payload: { q, source: "semantic", count: res.items.length },
      });
    } catch (err) {
      if (id !== reqId.current) return;
      // 向量後端（Ollama）不可用 → 離線降級狀態，與真實錯誤區分（roadmap P2-6）。
      setStatus(err instanceof SemanticDegradedError ? "degraded" : "error");
    }
  }, []);

  // 由選區選單「相似搜尋」帶入的 ?q=：掛載／URL 變動時自動跑一次。
  const urlQuery = searchParams.get("q") ?? "";
  useEffect(() => {
    if (urlQuery.trim()) {
      setQuery(urlQuery);
      void doSearch(urlQuery);
    }
  }, [urlQuery, doSearch]);

  function runSearch(e: FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    void doSearch(query);
  }

  const topScore = hits.length > 0 ? Math.round((hits[0].score ?? 0) * 100) : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title={t("navSearch")} subtitle={t("searchPageSub")} />

      <form
        onSubmit={runSearch}
        className="flex items-center gap-2 rounded-xl border border-border bg-card p-3"
      >
        <Search className="ml-1.5 h-4 w-4 shrink-0 text-ink-dim" aria-hidden />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="border-0 bg-transparent px-1 focus-visible:ring-0"
          aria-label={t("navSearch")}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={!query.trim() || status === "loading"}
        >
          {status === "loading" ? t("searching") : t("searchAction")}
        </Button>
      </form>

      {status === "idle" && (
        <EmptyState title={t("searchEmptyTitle")} hint={t("searchEmptyHint")} />
      )}

      {status === "error" && (
        <EmptyState
          title={t("searchError")}
          hint={t("searchEmptyHint")}
          tone="error"
        />
      )}

      {status === "degraded" && (
        <EmptyState
          title={t("searchDegradedTitle")}
          hint={t("searchDegradedHint")}
          tone="warn"
        />
      )}

      {status === "done" && hits.length === 0 && (
        <EmptyState title={t("searchNoResult")} hint={t("searchEmptyHint")} />
      )}

      {status === "done" && hits.length > 0 && (
        <TenderTable
          tenders={hits.map((h) => h.tender)}
          caption={`${t("searchResultCaption")} · ${STRINGS[lang].searchScore(topScore)}`}
        />
      )}
    </div>
  );
}

function EmptyState({
  title,
  hint,
  tone = "default",
}: {
  title: string;
  hint?: string;
  tone?: "default" | "error" | "warn";
}) {
  const titleClass =
    tone === "error"
      ? "text-[13px] font-medium text-danger"
      : tone === "warn"
        ? "text-[13px] font-medium text-warning"
        : "text-[13px] font-medium text-ink";
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-16 text-center">
      <p className={titleClass}>{title}</p>
      {hint && <p className="mt-1 text-[12px] text-ink-dim">{hint}</p>}
    </div>
  );
}
