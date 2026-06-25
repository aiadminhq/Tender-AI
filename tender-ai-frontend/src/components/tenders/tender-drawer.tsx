import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Ban,
  Check,
  Clock,
  ExternalLink,
  Link,
  Mail,
  Star,
  X,
} from "lucide-react";
import type { Tender, TenderRevisionDetail } from "@/types/domain";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { userById } from "@/data/users";
import {
  formatBudget,
  formatDateLong,
  formatRelative,
  daysLeft,
  isValidDate,
} from "@/lib/format";
import { trackEvent } from "@/lib/events";
import {
  postRate,
  postShare,
  fetchTenderDetail,
  fetchSimilarTenders,
  fetchDecisionRecommendation,
  type SimilarTender,
  type DecisionRecommendation,
} from "@/lib/api";
import { load, save } from "@/lib/storage";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Input } from "@/components/ui/input";
import {
  Fact,
  SectionLabel,
  LabelTags,
  RevisionDetailBlock,
  SimilarCasesList,
  DecisionRecommendationBlock,
  RatingStars,
} from "@/components/tenders/detail-bits";
import { FeasibilityMeter } from "@/components/ui/feasibility-meter";
import { cn } from "@/lib/utils";

export function TenderDrawer({
  tender,
  onClose,
}: {
  tender: Tender | null;
  onClose: () => void;
}) {
  const { t, lang } = useApp();
  const navigate = useNavigate();
  const {
    commentsOf,
    addComment,
    isStarred,
    toggleStar,
    accept,
    skip,
    isExcluded,
    excludeReasonOf,
    feasOf,
    keywordHitsOf,
  } = useAppData();
  const [text, setText] = useState("");
  const [rating, setRating] = useState(0);
  const [isPublic, setIsPublic] = useState(false);
  // 後端 revision 詳情與相似案（彈窗開啟時按 tenderId 抓取）。
  const [revision, setRevision] = useState<TenderRevisionDetail | null>(null);
  const [similar, setSimilar] = useState<SimilarTender[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  // 承接傾向決策推薦（P5）；後端／決策向量不可用時 rec=null，區塊優雅退化。
  const [rec, setRec] = useState<DecisionRecommendation | null>(null);
  const [recLoading, setRecLoading] = useState(false);

  // 切換不同標案時清空草稿：用「prop 變更時於 render 期調整 state」取代 effect。
  const [lastTenderId, setLastTenderId] = useState(tender?.id);
  if (tender?.id !== lastTenderId) {
    setLastTenderId(tender?.id);
    setText("");
    setRating(0);
    setIsPublic(false);
    // 從 localStorage 還原評價與可見性
    setRating(
      load<{ star: number }>(`rating:${tender?.id ?? ""}`, { star: 0 }).star,
    );
    setIsPublic(
      load<string>(`visibility:${tender?.id ?? ""}`, "private") === "public",
    );
  }

  // 抓取後端詳情（revision）與相似案；切換標案時以 AbortController 取消前一次請求。
  const tenderId = tender?.id;
  useEffect(() => {
    if (!tenderId) {
      setRevision(null);
      setSimilar([]);
      setSimilarLoading(false);
      setRec(null);
      setRecLoading(false);
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    setRevision(null);
    fetchTenderDetail(tenderId, signal)
      .then((d) => setRevision(d?.revision ?? null))
      .catch(() => {
        if (!signal.aborted) setRevision(null);
      });
    setSimilar([]);
    setSimilarLoading(true);
    fetchSimilarTenders(tenderId, 4, signal)
      .then((items) => {
        if (!signal.aborted) setSimilar(items);
      })
      .catch(() => {
        if (!signal.aborted) setSimilar([]);
      })
      .finally(() => {
        if (!signal.aborted) setSimilarLoading(false);
      });
    setRec(null);
    setRecLoading(true);
    fetchDecisionRecommendation(tenderId, 8, signal)
      .then((d) => {
        if (!signal.aborted) setRec(d);
      })
      .catch(() => {
        if (!signal.aborted) setRec(null);
      })
      .finally(() => {
        if (!signal.aborted) setRecLoading(false);
      });
    return () => controller.abort();
  }, [tenderId]);

  const comments = tender ? commentsOf(tender.id) : [];
  const starred = tender ? isStarred(tender.id) : false;
  const excluded = tender ? isExcluded(tender) : false;
  const reason = excluded && tender ? excludeReasonOf(tender) : undefined;
  const feas = tender ? feasOf(tender) : null;
  // 可行性加減項拆解（移到快照格的 hover 提示，沿用原 FeasibilityBadge 行為）。
  const feasTip =
    feas && feas.breakdown.length
      ? feas.breakdown
          .map((b) => `${b.delta >= 0 ? "+" : ""}${b.delta} ${b.label}`)
          .join("  ")
      : t("feasDefault");
  const validDeadline = !!tender && isValidDate(tender.deadline);
  const dleft = tender && validDeadline ? daysLeft(tender.deadline) : 0;
  const deadlineTone =
    dleft < 0
      ? "text-ink-dim"
      : dleft <= 3
        ? "text-tier-low"
        : dleft <= 7
          ? "text-tier-mid"
          : "text-ink-muted";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!tender || !text.trim()) return;
    addComment(tender.id, text.trim());
    setText("");
  };

  // Step 2: 行為鈕處理器
  const onRate = (star: number) => {
    if (!tender) return;
    setRating(star);
    postRate(tender.id, star);
    save(`rating:${tender.id}`, { star });
  };

  const onForward = (channel: "link" | "email") => {
    if (!tender) return;
    postShare(tender.id, channel);
    if (channel === "link" && tender.link) {
      void navigator.clipboard?.writeText(tender.link).catch(() => {});
    }
  };

  const togglePublic = () => {
    if (!tender) return;
    const next = !isPublic;
    setIsPublic(next);
    save(`visibility:${tender.id}`, next ? "public" : "private");
  };

  return (
    <Dialog
      open={!!tender}
      onClose={onClose}
      title={tender && <span className="line-clamp-2">{tender.title}</span>}
    >
      {tender && (
        <div className="space-y-4">
          {/* 標題列下方：標籤列 + 收藏鈕（可行性分數移入下方快照格） */}
          <div className="flex flex-wrap items-center gap-2">
            <LabelTags tender={tender} lang={lang} t={t} />
            <button
              type="button"
              onClick={() => toggleStar(tender.id)}
              aria-label={starred ? t("unstar") : t("star")}
              title={starred ? t("unstar") : t("star")}
              className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-accent"
            >
              <Star
                size={15}
                className={cn(
                  starred ? "fill-tier-mid text-tier-mid" : "text-ink-dim",
                )}
              />
            </button>
          </div>

          {/* 排除提示 */}
          {reason && (
            <Alert variant="danger" icon={<Ban size={14} className="mt-0.5" />}>
              <span>{reason}</span>
            </Alert>
          )}

          {/* 主體雙欄 grid */}
          <div className="grid gap-6 md:grid-cols-3">
            {/* 左欄：主資訊（2/3） */}
            <div className="space-y-5 md:col-span-2">
              {/* 快照格：可行性分數 + 漸層條（hover 看加減項拆解）＋ 急迫度。
                  合併原本散落的可行性徽章／量表／截止警示，消除重複顯示。 */}
              <div
                title={`${t("feasBreakdown")}: ${feasTip}`}
                className="rounded-md border border-border bg-surface-1 px-4 py-3.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-ink-dim">
                    {t("feasibility")}
                  </span>
                  <span className="tnum text-[22px] font-semibold leading-none text-signal">
                    {feasOf(tender).score}
                  </span>
                </div>
                <FeasibilityMeter
                  value={feasOf(tender).score}
                  className="mt-2.5"
                />
                {dleft < 7 && (
                  <div
                    className={cn(
                      "mt-3 flex items-center gap-1.5 text-[12px] font-medium",
                      dleft < 0 ? "text-ink-dim" : "text-danger",
                    )}
                  >
                    <Clock size={13} className="shrink-0" />
                    <span>
                      {dleft < 0
                        ? t("deadlinePassed")
                        : `${dleft} ${t("daysLeft")}`}
                    </span>
                  </div>
                )}
              </div>

              {/* 下一步 */}
              {tender.nextStep && (
                <div>
                  <SectionLabel>{t("colNext")}</SectionLabel>
                  <p className="text-[13px] leading-relaxed text-ink">
                    {tender.nextStep}
                  </p>
                </div>
              )}

              {/* 事實格 */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Fact label={t("org")}>
                  <span className="block truncate">{tender.org}</span>
                </Fact>
                <Fact label={t("publishedAt")} num>
                  {formatDateLong(tender.publishedAt, lang)}
                </Fact>
                <Fact label={t("colBudget")} num>
                  {formatBudget(tender.budget, lang)}
                </Fact>
                <Fact label={t("colDeadline")} num>
                  {formatDateLong(tender.deadline, lang)}
                  {validDeadline && (
                    <span className={cn("ml-1.5 text-[11px]", deadlineTone)}>
                      {dleft < 0
                        ? t("deadlinePassed")
                        : `${dleft} ${t("daysLeft")}`}
                    </span>
                  )}
                </Fact>
                {tender.caseNo && (
                  <Fact label={t("caseNo")} num>
                    <span className="block truncate">{tender.caseNo}</span>
                  </Fact>
                )}
                {tender.tenderMethod && (
                  <Fact label={t("tenderMethod")}>{tender.tenderMethod}</Fact>
                )}
                {tender.city && <Fact label={t("city")}>{tender.city}</Fact>}
              </dl>

              {/* 關鍵匹配 */}
              {(() => {
                const hits = keywordHitsOf(tender);
                return hits.length > 0 ? (
                  <div>
                    <SectionLabel>
                      {t("matchedCount")} {hits.length}
                    </SectionLabel>
                    <div className="flex flex-wrap gap-1.5">
                      {hits.map((tag) => (
                        <Badge key={tag} variant="signal">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}

              {/* 後端詳情（履約／資格／押標金／附件）；未 enrich 時優雅退化為空狀態 */}
              <RevisionDetailBlock revision={revision} lang={lang} t={t} />

              {/* 承接傾向（P5 決策推薦）：聚合相似已評估案例給可解釋傾向 */}
              <div>
                <SectionLabel>{t("decisionLeaning")}</SectionLabel>
                <DecisionRecommendationBlock
                  rec={rec}
                  loading={recLoading}
                  t={t}
                  onSelect={onClose}
                />
              </div>

              {/* 相似案（向量檢索）；點擊後關閉彈窗並導向該案 */}
              <div>
                <SectionLabel>{t("similarCases")}</SectionLabel>
                <SimilarCasesList
                  items={similar}
                  loading={similarLoading}
                  t={t}
                  onSelect={onClose}
                />
              </div>

              {/* 詳情動作：原文連結 + 完整詳情頁 */}
              <div className="flex flex-col gap-2 sm:flex-row">
                {tender.link && (
                  <a
                    href={tender.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      trackEvent("click_link", { tenderId: tender.id })
                    }
                    className={cn(
                      buttonVariants({ variant: "ghost" }),
                      "flex-1 justify-center",
                    )}
                  >
                    <ExternalLink size={15} /> {t("sourcePage")}
                  </a>
                )}
                <Button
                  variant="outline"
                  className="flex-1 justify-center"
                  onClick={() => {
                    onClose();
                    navigate(`/tenders/${tender.id}`);
                  }}
                >
                  {t("viewFullDetail")} <ArrowRight size={15} />
                </Button>
              </div>
            </div>

            {/* 右欄：行動 + 社群（1/3） */}
            <div className="space-y-5">
              {/* 承接 / 略過 */}
              <div className="flex flex-col gap-2">
                <Button
                  variant="primary"
                  onClick={() => {
                    accept(tender.id);
                    onClose();
                  }}
                >
                  <Check size={15} /> {t("accept")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    skip(tender.id);
                    onClose();
                  }}
                >
                  <X size={15} /> {t("skip")}
                </Button>
              </div>

              {/* 評價 */}
              <div>
                <SectionLabel>{t("rate")}</SectionLabel>
                <RatingStars value={rating} onRate={onRate} />
              </div>

              {/* 轉發 */}
              <div>
                <SectionLabel>{t("forward")}</SectionLabel>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => onForward("link")}
                    className="justify-start"
                  >
                    <Link size={14} /> {t("forwardLink")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => onForward("email")}
                    className="justify-start"
                  >
                    <Mail size={14} /> {t("forwardEmail")}
                  </Button>
                </div>
              </div>

              {/* 公開 / 私人 toggle */}
              <div>
                <SectionLabel>{t("visibility")}</SectionLabel>
                <Button
                  variant={isPublic ? "primary" : "outline"}
                  onClick={togglePublic}
                  className="w-full"
                >
                  {isPublic ? t("visPublic") : t("visPrivate")}
                </Button>
              </div>

              {/* 註記 */}
              <div>
                <SectionLabel>{t("comments")}</SectionLabel>
                {comments.length === 0 ? (
                  <p className="text-[12px] text-ink-dim">{t("notesEmpty")}</p>
                ) : (
                  <ul className="space-y-2.5">
                    {comments.map((c) => (
                      <li
                        key={c.id}
                        className="rounded-md bg-surface-1 px-3 py-2"
                      >
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
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={!text.trim()}
                  >
                    {t("send")}
                  </Button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
