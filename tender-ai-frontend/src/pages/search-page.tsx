import { useRef, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { useApp } from "@/store/app-context";
import { STRINGS } from "@/i18n/strings";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TenderTable } from "@/components/tenders/tender-table";
import { searchSemantic, type SimilarTender } from "@/lib/api";
import { trackEvent } from "@/lib/events";

type Status = "idle" | "loading" | "done" | "error";

export function SearchPage() {
  const { t, lang } = useApp();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [hits, setHits] = useState<SimilarTender[]>([]);
  // 競態保護：只認最後一次送出的查詢結果。
  const reqId = useRef(0);

  async function runSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || status === "loading") return;

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
    } catch {
      if (id !== reqId.current) return;
      setStatus("error");
    }
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
  tone?: "default" | "error";
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-16 text-center">
      <p
        className={
          tone === "error"
            ? "text-[13px] font-medium text-danger"
            : "text-[13px] font-medium text-ink"
        }
      >
        {title}
      </p>
      {hint && <p className="mt-1 text-[12px] text-ink-dim">{hint}</p>}
    </div>
  );
}
