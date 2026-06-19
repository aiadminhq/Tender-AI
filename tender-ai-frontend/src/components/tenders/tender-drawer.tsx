import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Ban,
  Check,
  ExternalLink,
  Link,
  Mail,
  Star,
  X,
} from "lucide-react";
import type { Tender } from "@/types/domain";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { userById } from "@/data/users";
import {
  formatBudget,
  formatDateLong,
  formatRelative,
  daysLeft,
} from "@/lib/format";
import { trackEvent } from "@/lib/events";
import { postRate, postShare } from "@/lib/api";
import { load, save } from "@/lib/storage";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Input } from "@/components/ui/input";
import {
  Fact,
  MeterRow,
  SectionLabel,
  LabelTags,
  FeasibilityBadge,
  DaysLeftBanner,
  PlaceholderBlock,
  RatingStars,
} from "@/components/tenders/detail-bits";
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

  const comments = tender ? commentsOf(tender.id) : [];
  const starred = tender ? isStarred(tender.id) : false;
  const excluded = tender ? isExcluded(tender) : false;
  const reason = excluded && tender ? excludeReasonOf(tender) : undefined;
  const dleft = tender ? daysLeft(tender.deadline) : 0;
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
          {/* 標題列下方：標籤列 + 可行性徽章 + 收藏鈕 */}
          <div className="flex flex-wrap items-center gap-2">
            <LabelTags tender={tender} lang={lang} t={t} />
            <FeasibilityBadge result={feasOf(tender)} t={t} />
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
            <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-[12px] text-danger">
              <Ban size={14} className="mt-0.5 shrink-0" />
              <span>{reason}</span>
            </div>
          )}

          {/* 主體雙欄 grid */}
          <div className="grid gap-6 md:grid-cols-3">
            {/* 左欄：主資訊（2/3） */}
            <div className="space-y-5 md:col-span-2">
              {/* 截止日警示條 */}
              <DaysLeftBanner daysLeft={dleft} t={t} />

              {/* 可行性量表 */}
              <MeterRow label={t("feasibility")} value={feasOf(tender).score} />

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
                  <span className={cn("ml-1.5 text-[11px]", deadlineTone)}>
                    {dleft < 0
                      ? t("deadlinePassed")
                      : `${dleft} ${t("daysLeft")}`}
                  </span>
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

              {/* 待補欄位 */}
              <PlaceholderBlock label={t("deliveryLocation")} t={t} />
              <PlaceholderBlock label={t("qualification")} t={t} />
              <PlaceholderBlock label={t("attachments")} t={t} />
              <PlaceholderBlock label={t("similarCases")} t={t} />

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
                  <p className="text-[12px] text-ink-dim">
                    {lang === "en" ? "No notes yet" : "尚無註記"}
                  </p>
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
