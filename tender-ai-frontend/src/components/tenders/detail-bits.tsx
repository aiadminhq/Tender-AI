import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Lang, TextKey } from "@/i18n/strings";
import type {
  Category,
  StructuredItem,
  Tender,
  TenderAttachment,
  TenderRevisionDetail,
} from "@/types/domain";
import type { FeasResult } from "@/lib/feasibility";
import type {
  DecisionRecommendation,
  DecisionVerdict,
  SimilarTender,
} from "@/lib/api";
import { FeasibilityMeter } from "@/components/ui/feasibility-meter";
import {
  Star,
  Clock,
  FileText,
  HardHat,
  Package,
  Briefcase,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TierBadge } from "@/components/ui/tier-badge";
import { sourceByKey } from "@/data/sources";
import { formatBudget, formatDateLong } from "@/lib/format";
import { cn } from "@/lib/utils";

// 標案詳情的共用小元件：drawer（peek）與詳情頁共用，避免兩處複製。

/** 事實格：上標籤、下值；num 啟用等寬數字（tnum）。 */
export function Fact({
  label,
  children,
  num,
}: {
  label: string;
  children: ReactNode;
  num?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-ink-dim">{label}</dt>
      <dd className={cn("mt-0.5 text-[13px] text-ink", num && "tnum")}>
        {children}
      </dd>
    </div>
  );
}

/** 量表列：左標籤、右數值 + 進度條。 */
export function MeterRow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] text-ink-muted">{label}</span>
        <span className="tnum text-[12px] font-medium text-ink">{value}</span>
      </div>
      <FeasibilityMeter value={value} />
    </div>
  );
}

/** 區塊小標：全大寫、字距加寬的次級標題。 */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-dim">
      {children}
    </div>
  );
}

// —— 下方為 Task 6 新增的展示元件 ——

export const CAT_KEY: Record<Category, TextKey> = {
  works: "catWorks",
  goods: "catGoods",
  services: "catServices",
};
const CAT_VARIANT: Record<Category, "signal" | "muted" | "outline"> = {
  works: "signal",
  goods: "muted",
  services: "outline",
};

/** 類別圖示：以「形狀」區分類別（房屋風格：類別差異靠 icon 形狀，不疊加第二彩色 accent）。 */
export const CAT_ICON: Record<Category, LucideIcon> = {
  works: HardHat,
  goods: Package,
  services: Briefcase,
};

/** 來源 + 類別色標 + 城市 Badge 列。 */
export function LabelTags({
  tender,
  lang,
  t,
}: {
  tender: Tender;
  lang: Lang;
  t: (k: TextKey) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TierBadge tier={tender.tier} lang={lang} />
      <Badge variant="muted">{sourceByKey(tender.source).shortName}</Badge>
      <Badge variant={CAT_VARIANT[tender.category]}>
        {t(CAT_KEY[tender.category])}
      </Badge>
      {tender.city && <Badge variant="outline">{tender.city}</Badge>}
    </div>
  );
}

/** 可行性分數徽章 + hover tooltip 拆解。 */
export function FeasibilityBadge({
  result,
  t,
}: {
  result: FeasResult;
  t: (k: TextKey) => string;
}) {
  const tip = result.breakdown.length
    ? result.breakdown
        .map((b) => `${b.delta >= 0 ? "+" : ""}${b.delta} ${b.label}`)
        .join("  ")
    : t("feasDefault");
  return (
    <span
      title={`${t("feasBreakdown")}: ${tip}`}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[12px] font-medium text-ink"
    >
      {t("feasibility")}
      <span className="tnum text-signal">{result.score}</span>
    </span>
  );
}

/** 剩餘 <7 天紅色警示條（含已過）。 */
export function DaysLeftBanner({
  daysLeft,
  t,
}: {
  daysLeft: number;
  t: (k: TextKey) => string;
}) {
  if (daysLeft >= 7) return null;
  const text =
    daysLeft < 0 ? t("deadlinePassed") : `${daysLeft} ${t("daysLeft")}`;
  return (
    <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-[12px] font-medium text-danger">
      <Clock size={14} className="shrink-0" />
      <span>{text}</span>
    </div>
  );
}

/** 「待補」佔位（後端尚未吐出的欄位）。 */
export function PlaceholderBlock({
  label,
  t,
}: {
  label: string;
  t: (k: TextKey) => string;
}) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="rounded-md border border-dashed border-border bg-surface-1 px-3 py-2 text-[12px] text-ink-dim">
        <span className="mr-1 rounded bg-surface-2 px-1.5 py-0.5">
          {t("pending")}
        </span>
        {t("pendingDesc")}
      </div>
    </div>
  );
}

// —— 標案詳情版本（revision）展示：履約／資格／押標金／附件／相似案 ——

/** 押標金顯示：金額優先 → 原文 → 免押標金；皆無則 null（不顯示該格）。 */
function depositText(
  rev: TenderRevisionDetail,
  lang: Lang,
  t: (k: TextKey) => string,
): string | null {
  if (rev.depositAmountTwd != null)
    return formatBudget(rev.depositAmountTwd, lang);
  if (rev.depositRawText) return rev.depositRawText;
  if (rev.depositRequired === false) return t("depositNone");
  return null;
}

/** 附件索引清單：檔名 + 歸檔／略過標記 + 開啟連結；空清單顯示提示。 */
export function AttachmentList({
  attachments,
  t,
}: {
  attachments: TenderAttachment[];
  t: (k: TextKey) => string;
}) {
  if (!attachments.length) {
    return <p className="text-[12px] text-ink-dim">{t("attachmentsEmpty")}</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {attachments.map((a, i) => (
        <li key={i} className="flex items-center gap-2 text-[12px]">
          <FileText size={13} className="shrink-0 text-ink-dim" />
          <span className="min-w-0 flex-1 truncate text-ink">
            {a.filename ?? "—"}
          </span>
          {a.archived && (
            <Badge variant="muted">{t("attachmentArchived")}</Badge>
          )}
          {a.skipped && (
            <Badge variant="outline">{t("attachmentSkipped")}</Badge>
          )}
          {a.url && (
            <a
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-signal hover:underline"
            >
              {t("attachmentOpen")}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

/** 資格要求摘要表格：把長文結構化條目（屬性／標籤／內文）照標案頁面以表格呈現。
 *
 * 條目來自後端 qualification_items（離線結構化或即時投影）。kind 區分：
 * note＝小標（如「符合下列任一」，跨欄呈現）、code＝資格代碼（label mono、content 名稱）、
 * requirement＝要求項（label 項次、content 內文）。資料源為 Layer A 公開、可重算。 */
function QualificationTable({
  items,
  t,
}: {
  items: StructuredItem[];
  t: (k: TextKey) => string;
}) {
  return (
    <div className="mt-1.5 overflow-hidden rounded-2xl border border-hairline">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-surface-2 text-left text-[11px] text-ink-dim">
            <th className="w-[28%] px-3 py-2 font-medium">
              {t("qualColItem")}
            </th>
            <th className="px-3 py-2 font-medium">{t("qualColContent")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {items.map((it, i) => {
            const key = `${it.kind}-${it.label ?? ""}-${i}`;
            if (it.kind === "note") {
              return (
                <tr key={key} className="bg-card">
                  <td
                    colSpan={2}
                    className="px-3 py-2 text-[12px] font-medium text-ink-muted"
                  >
                    {it.content}
                  </td>
                </tr>
              );
            }
            const isCode = it.kind === "code";
            return (
              <tr key={key}>
                <td className="whitespace-nowrap px-3 py-2 align-top">
                  {it.label ? (
                    <span className={isCode ? "tnum text-ink" : "text-ink-dim"}>
                      {it.label}
                    </span>
                  ) : (
                    <span className="text-ink-dim">·</span>
                  )}
                </td>
                <td className="px-3 py-2 align-top leading-relaxed text-ink">
                  {it.content}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 標案詳情版本：有 revision 時呈現履約/資格/押標金/類別/附件；
 * 未 enrich（revision 為 null）時優雅退化為空狀態提示。 */
export function RevisionDetailBlock({
  revision,
  lang,
  t,
}: {
  revision?: TenderRevisionDetail | null;
  lang: Lang;
  t: (k: TextKey) => string;
}) {
  if (!revision) {
    return (
      <div>
        <SectionLabel>{t("revisionDetail")}</SectionLabel>
        <div className="rounded-md border border-dashed border-border bg-surface-1 px-3 py-2 text-[12px] text-ink-dim">
          {t("revisionEmpty")}
        </div>
      </div>
    );
  }

  const deposit = depositText(revision, lang, t);
  const category =
    revision.categoryName ??
    revision.categoryRaw ??
    revision.categoryMain ??
    null;
  const facts: { label: string; value: string }[] = [];
  if (revision.performanceLocation)
    facts.push({
      label: t("deliveryLocation"),
      value: revision.performanceLocation,
    });
  if (revision.performancePeriod)
    facts.push({
      label: t("performancePeriod"),
      value: revision.performancePeriod,
    });
  if (revision.awardMethod)
    facts.push({ label: t("awardMethod"), value: revision.awardMethod });
  if (deposit) facts.push({ label: t("deposit"), value: deposit });
  if (category)
    facts.push({ label: t("procurementCategory"), value: category });
  if (revision.subsidySource)
    facts.push({ label: t("subsidySource"), value: revision.subsidySource });

  const qualItems = revision.qualificationItems ?? [];
  const hasQualification =
    qualItems.length > 0 ||
    Boolean(revision.qualificationText) ||
    revision.qualificationCodes.length > 0;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-dim">
          {t("revisionDetail")}
        </span>
        {revision.fetchedAt && (
          <span className="text-[10px] text-ink-dim">
            {t("revisionFetchedAt")} {formatDateLong(revision.fetchedAt, lang)}
          </span>
        )}
      </div>

      {facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {facts.map((f) => (
            <Fact key={f.label} label={f.label}>
              {f.value}
            </Fact>
          ))}
        </dl>
      )}

      {hasQualification && (
        <div className="mt-3">
          <div className="text-[11px] text-ink-dim">{t("qualification")}</div>
          {qualItems.length > 0 ? (
            <QualificationTable items={qualItems} t={t} />
          ) : (
            <>
              {revision.qualificationText && (
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink">
                  {revision.qualificationText}
                </p>
              )}
              {revision.qualificationCodes.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {revision.qualificationCodes.map((c) => (
                    <Badge key={c} variant="outline">
                      {c}
                    </Badge>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="mt-3">
        <div className="text-[11px] text-ink-dim">{t("attachments")}</div>
        <div className="mt-1">
          <AttachmentList attachments={revision.attachments} t={t} />
        </div>
      </div>

      {revision.extraNote && (
        <div className="mt-3">
          <div className="text-[11px] text-ink-dim">{t("extraNote")}</div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink">
            {revision.extraNote}
          </p>
        </div>
      )}
    </div>
  );
}

/** 相似案清單（向量檢索）：載入中／空集合各有提示；onSelect 供彈窗點擊後關閉。 */
export function SimilarCasesList({
  items,
  loading,
  t,
  onSelect,
}: {
  items: SimilarTender[];
  loading: boolean;
  t: (k: TextKey) => string;
  onSelect?: () => void;
}) {
  if (loading) {
    return <p className="text-[12px] text-ink-dim">{t("similarLoading")}</p>;
  }
  if (!items.length) {
    return <p className="text-[12px] text-ink-dim">{t("similarEmpty")}</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map(({ tender, score }) => (
        <li key={tender.id}>
          <Link
            to={`/tenders/${tender.id}`}
            onClick={onSelect}
            className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 transition-colors hover:bg-accent"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-ink">
                {tender.title}
              </span>
              <span className="block truncate text-[11px] text-ink-dim">
                {tender.org}
              </span>
            </span>
            <span className="tnum shrink-0 text-[11px] text-signal">
              {Math.round(score * 100)}%
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// 承接傾向結論 → 配色（綠＝偏可行、紅＝偏不可行、灰＝資料不足）。
const VERDICT_META: Record<
  DecisionVerdict,
  { key: TextKey; tone: string; dot: string }
> = {
  feasible_leaning: {
    key: "leaningFeasible",
    tone: "text-tier-high",
    dot: "bg-tier-high",
  },
  infeasible_leaning: {
    key: "leaningInfeasible",
    tone: "text-tier-low",
    dot: "bg-tier-low",
  },
  unknown: { key: "leaningUnknown", tone: "text-ink-dim", dot: "bg-ink-dim" },
};

/** 承接傾向決策推薦（P5）：聚合相似已評估案例給候選標案一個可解釋的傾向。
 *  載入中／資料不足（後端或決策向量不可用、無鄰居且無傾向）各有提示，優雅退化。
 *  鄰居僅帶結論標籤（可行／不可行），不外洩 rationale 全文或使用者身分。 */
export function DecisionRecommendationBlock({
  rec,
  loading,
  t,
  onSelect,
}: {
  rec: DecisionRecommendation | null;
  loading: boolean;
  t: (k: TextKey) => string;
  onSelect?: () => void;
}) {
  if (loading) {
    return <p className="text-[12px] text-ink-dim">{t("decisionLoading")}</p>;
  }
  if (!rec || (rec.verdict === "unknown" && rec.neighbors.length === 0)) {
    return <p className="text-[12px] text-ink-dim">{t("decisionEmpty")}</p>;
  }
  const meta = VERDICT_META[rec.verdict];
  const pct = Math.round(rec.confidence * 100);
  return (
    <div className="rounded-md border border-border bg-surface-1 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-[13px] font-semibold",
            meta.tone,
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
          {t(meta.key)}
        </span>
        <span className="tnum text-[12px] text-ink-muted">
          {t("decisionConfidence")} {pct}%
        </span>
      </div>
      {rec.headline && (
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
          {rec.headline}
        </p>
      )}
      <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-dim">
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-tier-high" />
          {t("conclFeasible")}{" "}
          <span className="tnum text-ink">{rec.feasibleCount}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-tier-low" />
          {t("conclInfeasible")}{" "}
          <span className="tnum text-ink">{rec.infeasibleCount}</span>
        </span>
      </div>
      {rec.neighbors.length > 0 && (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {rec.neighbors.map(({ tender, feasible }) => {
            const ok = !feasible.includes("不");
            return (
              <li key={tender.id}>
                <Link
                  to={`/tenders/${tender.id}`}
                  onClick={onSelect}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 transition-colors hover:bg-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-ink">
                      {tender.title}
                    </span>
                    <span className="block truncate text-[11px] text-ink-dim">
                      {tender.org}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-[11px] font-medium",
                      ok ? "text-tier-high" : "text-tier-low",
                    )}
                  >
                    {ok ? t("conclFeasible") : t("conclInfeasible")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 5★ 可點評價。 */
export function RatingStars({
  value,
  onRate,
}: {
  value: number;
  onRate: (star: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n}`}
          onClick={() => onRate(n)}
          className="grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-accent"
        >
          <Star
            size={16}
            className={
              n <= value ? "fill-tier-mid text-tier-mid" : "text-ink-dim"
            }
          />
        </button>
      ))}
    </div>
  );
}
