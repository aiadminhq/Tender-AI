import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  Check,
  ExternalLink,
  History,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import type { Category, TenderDetail, TenderReasoning } from "@/types/domain";
import type { TextKey } from "@/i18n/strings";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import {
  fetchSimilarTenders,
  fetchTenderDetail,
  fetchTenderReasoning,
  type SimilarTender,
} from "@/lib/api";
import { trackEvent } from "@/lib/events";
import { sourceByKey } from "@/data/sources";
import { userById } from "@/data/users";
import {
  formatBudget,
  formatDateLong,
  formatRelative,
  daysLeft,
} from "@/lib/format";
import { TierBadge } from "@/components/ui/tier-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Input } from "@/components/ui/input";
import {
  Fact,
  MeterRow,
  SectionLabel,
  RevisionDetailBlock,
} from "@/components/tenders/detail-bits";
import { ReasoningPanel } from "@/components/tenders/reasoning-panel";
import { cn } from "@/lib/utils";

const CATEGORY_KEY: Record<Category, TextKey> = {
  works: "catWorks",
  goods: "catGoods",
  services: "catServices",
};

type LoadState = "loading" | "ready" | "fallback" | "notfound";

export function TenderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useApp();
  const navigate = useNavigate();
  const {
    tenders,
    commentsOf,
    addComment,
    isStarred,
    toggleStar,
    accept,
    skip,
    isExcluded,
    excludeReasonOf,
  } = useAppData();

  // 清單既有資料（live／mock 皆可），作為載入中骨架與 API 失敗時的回退來源。
  const base = useMemo(
    () => (id ? (tenders.find((x) => x.id === id) ?? null) : null),
    [tenders, id],
  );

  const [detail, setDetail] = useState<TenderDetail | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [text, setText] = useState("");
  const [similar, setSimilar] = useState<SimilarTender[]>([]);
  const [similarState, setSimilarState] = useState<"loading" | "ready">(
    "loading",
  );
  const [reasoning, setReasoning] = useState<TenderReasoning | null>(null);

  // 切換不同標案時重設視圖：用「prop 變更時於 render 期調整 state」取代 effect，
  // 避免在 effect body 同步呼叫 setState。下方 fetch effect 只負責 async 取資料。
  const [lastId, setLastId] = useState(id);
  if (id !== lastId) {
    setLastId(id);
    setText("");
    setState("loading");
    setDetail(null);
    setSimilar([]);
    setSimilarState("loading");
    setReasoning(null);
  }

  // 埋點：掛載送 open_detail，卸載送 dwell（停留毫秒）。
  useEffect(() => {
    if (!id) return;
    trackEvent("open_detail", { tenderId: id });
    const enteredAt = Date.now();
    return () => {
      trackEvent("dwell", {
        tenderId: id,
        payload: { ms: Date.now() - enteredAt },
      });
    };
  }, [id]);

  useEffect(() => {
    // 無 id 時不需打 API：下方 render 的 `!view` 分支會直接顯示 notfound。
    if (!id) return;
    const ac = new AbortController();
    fetchTenderDetail(id, ac.signal)
      .then((d) => {
        if (ac.signal.aborted) return;
        if (d) {
          setDetail(d);
          setState("ready");
        } else {
          // 後端回 404：若清單仍有此列就用清單資料，否則判定不存在。
          setState(base ? "fallback" : "notfound");
        }
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setState(base ? "fallback" : "notfound");
      });
    return () => ac.abort();
    // base 僅作回退，故意不入依賴以免 live 資料載入時重打 API。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 右欄相似案（Layer C 向量檢索）：與詳情各自獨立載入；
  // 失敗或向量索引未建立時靜默呈現空狀態，不影響詳情閱讀。
  useEffect(() => {
    if (!id) return;
    const ac = new AbortController();
    fetchSimilarTenders(id, 6, ac.signal)
      .then((hits) => {
        if (ac.signal.aborted) return;
        setSimilar(hits);
        setSimilarState("ready");
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setSimilar([]);
        setSimilarState("ready");
      });
    return () => ac.abort();
  }, [id]);

  // SL3 推理：「為什麼·推理」面板的可解釋判斷（fit + reason codes + 判準輪廓）。
  // 與詳情各自獨立載入；無評估／404 時靜默不顯示，不影響詳情閱讀。
  useEffect(() => {
    if (!id) return;
    const ac = new AbortController();
    fetchTenderReasoning(id, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return;
        setReasoning(r);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setReasoning(null);
      });
    return () => ac.abort();
  }, [id]);

  // 顯示資料：優先用詳情 API，否則回退清單列。
  const view = detail ?? base;

  if (id && state === "loading" && !view) {
    return (
      <div className="mx-auto max-w-5xl space-y-5">
        <BackLink label={t("backToList")} />
        <div className="animate-pulse space-y-4">
          <div className="h-32 rounded-xl border border-border bg-card" />
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="h-64 rounded-xl border border-border bg-card" />
            <div className="h-64 rounded-xl border border-border bg-card" />
          </div>
        </div>
        <p className="text-center text-[12px] text-ink-dim">
          {t("detailLoading")}
        </p>
      </div>
    );
  }

  if (!view || state === "notfound") {
    return (
      <div className="mx-auto max-w-5xl space-y-5">
        <BackLink label={t("backToList")} />
        <div className="rounded-xl border border-border bg-card px-6 py-16 text-center">
          <p className="text-[14px] font-medium text-ink">{t("notFound")}</p>
          <Link
            to="/tenders"
            className={cn(buttonVariants({ variant: "secondary" }), "mt-4")}
          >
            {t("backToList")}
          </Link>
        </div>
      </div>
    );
  }

  const starred = isStarred(view.id);
  const excluded = isExcluded(view);
  const reason = excluded ? excludeReasonOf(view) : undefined;
  const dleft = daysLeft(view.deadline);
  const deadlineTone =
    dleft < 0
      ? "text-ink-dim"
      : dleft <= 3
        ? "text-tier-low"
        : dleft <= 7
          ? "text-tier-mid"
          : "text-ink-muted";
  const comments = commentsOf(view.id);
  const snapshots = detail?.snapshots ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    addComment(view.id, text.trim());
    setText("");
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <BackLink label={t("backToList")} />

      {/* 主標頭：分級 / 來源 / 類別 + 標題 + 主要動作 */}
      <header className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <TierBadge tier={view.tier} lang={lang} />
          <Badge variant="muted">{sourceByKey(view.source).shortName}</Badge>
          <Badge variant="outline">{t(CATEGORY_KEY[view.category])}</Badge>
          {excluded && (
            <Badge variant="outline" className="text-danger">
              {t("excluded")}
            </Badge>
          )}
          <button
            type="button"
            onClick={() => toggleStar(view.id)}
            aria-label={starred ? t("unstar") : t("star")}
            title={starred ? t("unstar") : t("star")}
            className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors hover:bg-accent"
          >
            <Star
              size={16}
              className={cn(
                starred ? "fill-tier-mid text-tier-mid" : "text-ink-dim",
              )}
            />
          </button>
        </div>

        <h1 className="mt-3 text-[22px] font-semibold leading-snug tracking-tight text-ink">
          {view.title}
        </h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {sourceByKey(view.source).name}
          {view.caseNo && (
            <>
              <span className="mx-1.5 text-border">·</span>
              <span className="tnum">{view.caseNo}</span>
            </>
          )}
        </p>

        {/* 主要動作列 */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={() => {
              accept(view.id);
              navigate("/tenders");
            }}
          >
            <Check size={15} /> {t("accept")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              skip(view.id);
              navigate("/tenders");
            }}
          >
            <X size={15} /> {t("skip")}
          </Button>
          {view.link && (
            <a
              href={view.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent("click_link", { tenderId: view.id })}
              className={cn(buttonVariants({ variant: "ghost" }))}
            >
              <ExternalLink size={15} /> {t("sourcePage")}
            </a>
          )}
        </div>

        {state === "fallback" && (
          <p className="mt-3 text-[11px] text-ink-dim">{t("detailFailed")}</p>
        )}
      </header>

      {/* 排除提示 */}
      {reason && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2.5 text-[12px] text-danger">
          <Ban size={14} className="mt-0.5 shrink-0" />
          <span>{reason}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* 左欄：事實 + 量表 + 下一步 + 關鍵字 + 註記 */}
        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-card p-5">
            <SectionLabel>{t("overview")}</SectionLabel>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <Fact label={t("org")}>
                <span className="block truncate">{view.org}</span>
              </Fact>
              <Fact label={t("colBudget")} num>
                {formatBudget(view.budget, lang)}
              </Fact>
              <Fact label={t("colDeadline")} num>
                {formatDateLong(view.deadline, lang)}
                <span className={cn("ml-1.5 text-[11px]", deadlineTone)}>
                  {dleft < 0
                    ? t("deadlinePassed")
                    : `${dleft} ${t("daysLeft")}`}
                </span>
              </Fact>
              <Fact label={t("publishedAt")} num>
                {formatDateLong(view.publishedAt, lang)}
              </Fact>
              {view.tenderMethod && (
                <Fact label={t("tenderMethod")}>{view.tenderMethod}</Fact>
              )}
              {view.city && <Fact label={t("city")}>{view.city}</Fact>}
              {view.caseNo && (
                <Fact label={t("caseNo")} num>
                  <span className="block truncate">{view.caseNo}</span>
                </Fact>
              )}
              {view.lastSeen && (
                <Fact label={t("lastSeen")} num>
                  {formatDateLong(view.lastSeen, lang)}
                </Fact>
              )}
            </dl>

            <div className="mt-5 space-y-3">
              <MeterRow
                label={t("supplierCoverage")}
                value={view.supplierCoverage}
              />
              <MeterRow label={t("feasibility")} value={view.feasibility} />
            </div>

            {view.nextStep && (
              <div className="mt-5">
                <SectionLabel>{t("colNext")}</SectionLabel>
                <p className="text-[13px] leading-relaxed text-ink">
                  {view.nextStep}
                </p>
              </div>
            )}

            {view.tags.length > 0 && (
              <div className="mt-5">
                <SectionLabel>{t("keywords")}</SectionLabel>
                <div className="flex flex-wrap gap-1.5">
                  {view.tags.map((tag) => (
                    <Badge key={tag} variant="signal">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* 標案詳情（履約／資格／押標金／附件）；未 enrich 時優雅退化為空狀態 */}
          <section className="rounded-xl border border-border bg-card p-5">
            <RevisionDetailBlock
              revision={detail?.revision}
              lang={lang}
              t={t}
            />
          </section>

          {/* SL3 為什麼·推理：可中標判準吻合度 + 逐條依據 + 判準輪廓 */}
          {reasoning && (
            <ReasoningPanel
              reasoning={reasoning}
              lang={lang}
              t={t}
              onProfileChange={(profile) =>
                setReasoning((r) => (r ? { ...r, profile } : r))
              }
            />
          )}

          {/* 註記 */}
          <section className="rounded-xl border border-border bg-card p-5">
            <SectionLabel>{t("comments")}</SectionLabel>
            {comments.length === 0 ? (
              <p className="text-[12px] text-ink-dim">
                {lang === "en" ? "No notes yet" : "尚無註記"}
              </p>
            ) : (
              <ul className="space-y-2.5">
                {comments.map((c) => (
                  <li key={c.id} className="rounded-md bg-surface-1 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium text-ink">
                        {userById(c.userId)?.name ?? c.userId}
                      </span>
                      <span className="tnum text-[11px] text-ink-dim">
                        {formatRelative(c.at, lang)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
                      {c.text}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={submit} className="mt-3 flex gap-2">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("addComment")}
                aria-label={t("addComment")}
              />
              <Button type="submit" variant="secondary" disabled={!text.trim()}>
                {t("send")}
              </Button>
            </form>
          </section>
        </div>

        {/* 右欄：相似案（RAG）＋ 歷史快照時間軸 */}
        <aside className="space-y-4">
          {/* 相似案：Layer C 向量檢索，與詳情各自獨立載入 */}
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-dim">
              <Sparkles size={13} /> {t("similarCases")}
            </div>
            {similarState === "loading" ? (
              <p className="text-[12px] text-ink-dim">{t("similarLoading")}</p>
            ) : similar.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-ink-dim">
                {t("similarEmpty")}
              </p>
            ) : (
              <ul className="space-y-2">
                {similar.map(({ tender: s, score }) => (
                  <li key={s.id}>
                    <Link
                      to={`/tenders/${s.id}`}
                      className="block rounded-lg border border-border bg-surface-1 px-3 py-2.5 transition-colors hover:border-ink-dim/40 hover:bg-accent"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-[12px] font-medium leading-snug text-ink">
                          {s.title}
                        </span>
                        <TierBadge tier={s.tier} lang={lang} />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] text-ink-dim">
                          {s.org}
                        </span>
                        <span className="tnum shrink-0 text-[11px] font-medium text-signal">
                          {Math.round(score * 100)}%
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 歷史快照時間軸 */}
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-dim">
              <History size={13} /> {t("snapshotHistory")}
            </div>
            {snapshots.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-ink-dim">
                {t("snapshotEmpty")}
              </p>
            ) : (
              <ol className="relative space-y-3 border-l border-border pl-4">
                {snapshots.map((s, i) => (
                  <li key={`${s.runDate}-${i}`} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-border ring-2 ring-card" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="tnum text-[12px] text-ink">
                        {formatDateLong(s.runDate, lang)}
                      </span>
                      {s.tier && <TierBadge tier={s.tier} lang={lang} />}
                    </div>
                    {s.daysLeft != null && (
                      <p className="tnum mt-0.5 text-[11px] text-ink-dim">
                        {s.daysLeft < 0
                          ? t("deadlinePassed")
                          : `${s.daysLeft} ${t("daysLeft")}`}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Link
      to="/tenders"
      className="inline-flex items-center gap-1 text-[12px] text-ink-dim transition-colors hover:text-ink"
    >
      <ArrowLeft size={14} /> {label}
    </Link>
  );
}
