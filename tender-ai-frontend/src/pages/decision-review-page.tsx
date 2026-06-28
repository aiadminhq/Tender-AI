import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  ExternalLink,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData, type Disposition } from "@/store/app-data";
import { STRINGS, type TextKey } from "@/i18n/strings";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TierBadge } from "@/components/ui/tier-badge";
import { CAT_ICON, CAT_KEY } from "@/components/tenders/detail-bits";
import { SwipeDecisionDialog } from "@/components/swipe/swipe-decision-dialog";
import { formatDateLong } from "@/lib/format";

// 決策回顧（標案評分管理）：對標案執行星星／打勾／叉叉後，在此回顧「存留 vs 淘汰」，
// 並可重新分流（撤銷淘汰、收藏↔承接互轉）、補上具名淘汰理由。淘汰標案另提供
// 「拆解迴避字根」入口——重用速覽的 SwipeDecisionDialog(pass)：系統只建議、附理由，
// 唯有本人逐一確認才會以 kind=negative 寫回偏好（negative-keywords-human-only 紅線）。

// 已分流（非 none）才會出現在本頁；標籤與配色：收藏=signal、承接=success、淘汰=danger。
const DISP_LABEL: Record<Disposition, TextKey | null> = {
  starred: "dispStarred",
  accepted: "dispAccepted",
  skipped: "dispSkipped",
  none: null,
};
const DISP_VARIANT: Record<
  Disposition,
  "signal" | "success" | "danger" | "muted"
> = {
  starred: "signal",
  accepted: "success",
  skipped: "danger",
  none: "muted",
};

export function DecisionReviewPage() {
  const { t, lang } = useApp();
  const {
    tenders,
    dispositionOf,
    discardReasonOf,
    reclassify,
    setDiscardReason,
  } = useAppData();

  const [tab, setTab] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dlg, setDlg] = useState<{ tenderId: string; title: string } | null>(
    null,
  );

  // 已分流標案（含 disposition 快照），其餘自然不顯示。
  const decisions = useMemo(
    () =>
      tenders
        .map((tender) => ({ tender, disp: dispositionOf(tender.id) }))
        .filter((d) => d.disp !== "none"),
    [tenders, dispositionOf],
  );

  const counts = useMemo(() => {
    let starred = 0;
    let accepted = 0;
    let skipped = 0;
    for (const d of decisions) {
      if (d.disp === "starred") starred += 1;
      else if (d.disp === "accepted") accepted += 1;
      else if (d.disp === "skipped") skipped += 1;
    }
    return {
      starred,
      accepted,
      skipped,
      kept: starred + accepted,
      all: decisions.length,
    };
  }, [decisions]);

  const visible = useMemo(() => {
    switch (tab) {
      case "kept":
        return decisions.filter(
          (d) => d.disp === "starred" || d.disp === "accepted",
        );
      case "starred":
        return decisions.filter((d) => d.disp === "starred");
      case "accepted":
        return decisions.filter((d) => d.disp === "accepted");
      case "skipped":
        return decisions.filter((d) => d.disp === "skipped");
      default:
        return decisions;
    }
  }, [tab, decisions]);

  const skippedTenders = useMemo(
    () => decisions.filter((d) => d.disp === "skipped").map((d) => d.tender),
    [decisions],
  );

  const tabItems: TabItem[] = [
    { value: "all", label: `${t("decisionTabAll")} ${counts.all}` },
    { value: "kept", label: `${t("decisionTabKept")} ${counts.kept}` },
    {
      value: "starred",
      label: `${t("decisionTabStarred")} ${counts.starred}`,
    },
    {
      value: "accepted",
      label: `${t("decisionTabAccepted")} ${counts.accepted}`,
    },
    {
      value: "skipped",
      label: `${t("decisionTabSkipped")} ${counts.skipped}`,
    },
  ];

  function openEditor(tenderId: string) {
    setDraft(discardReasonOf(tenderId)?.reason ?? "");
    setEditingId(tenderId);
  }
  function saveReason() {
    if (editingId) setDiscardReason(editingId, draft);
    setEditingId(null);
    setDraft("");
  }

  const stats = [
    { key: "decisionStatKept" as TextKey, value: counts.kept },
    { key: "decisionStatStarred" as TextKey, value: counts.starred },
    { key: "decisionStatAccepted" as TextKey, value: counts.accepted },
    { key: "decisionStatSkipped" as TextKey, value: counts.skipped },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        title={t("navDecisionReview")}
        subtitle={t("decisionReviewSub")}
        actions={
          <Link to="/rules">
            <Button variant="outline" size="sm">
              <SlidersHorizontal size={14} />
              {t("decisionToRules")}
            </Button>
          </Link>
        }
      />

      {/* 計數總覽（Bento 小卡） */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.key}
            className="rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,.06)]"
          >
            <div className="text-[12px] text-ink-dim">{t(s.key)}</div>
            <div className="tnum mt-1 text-[22px] font-semibold text-ink">
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <Tabs
        value={tab}
        onValueChange={setTab}
        items={tabItems}
        aria-label={t("navDecisionReview")}
      />

      {/* 標案列 */}
      {decisions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-1 px-4 py-10 text-center text-[13px] text-ink-dim">
          {t("decisionEmptyAll")}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-1 px-4 py-10 text-center text-[13px] text-ink-dim">
          {t("decisionEmptyTab")}
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map(({ tender, disp }) => {
            const Icon = CAT_ICON[tender.category];
            const labelKey = DISP_LABEL[disp];
            const reason = discardReasonOf(tender.id);
            const editing = editingId === tender.id;
            return (
              <li
                key={tender.id}
                className="rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,.06)]"
              >
                <div className="flex items-start gap-3">
                  <Icon
                    size={16}
                    className="mt-1 shrink-0 text-ink-dim"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <TierBadge tier={tender.tier} lang={lang} />
                      {labelKey && (
                        <Badge variant={DISP_VARIANT[disp]}>
                          {t(labelKey)}
                        </Badge>
                      )}
                      <Badge variant="muted">
                        {t(CAT_KEY[tender.category])}
                      </Badge>
                    </div>

                    <Link
                      to={`/tenders/${tender.id}`}
                      className="mt-1.5 block truncate text-[14px] font-medium text-ink transition-colors hover:text-signal"
                    >
                      {tender.title}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-dim">
                      <span className="min-w-0 truncate">{tender.org}</span>
                      <span aria-hidden>·</span>
                      <span className="tnum shrink-0">
                        {formatDateLong(tender.deadline, lang)}
                      </span>
                    </div>

                    {/* 具名淘汰理由（僅淘汰且非編輯中時顯示） */}
                    {disp === "skipped" && reason && !editing && (
                      <div className="mt-2 rounded-md border border-danger/25 bg-danger/8 px-3 py-2 text-[12px] leading-relaxed">
                        <span className="text-ink">{reason.reason}</span>
                        <span className="ml-2 text-ink-dim">
                          {STRINGS[lang].decisionReasonBy(reason.by)} ·{" "}
                          {formatDateLong(reason.at, lang)}
                        </span>
                      </div>
                    )}

                    {/* 理由編輯器 */}
                    {editing && (
                      <div className="mt-2 space-y-2">
                        <textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          placeholder={t("decisionReasonPh")}
                          rows={2}
                          className="w-full resize-none rounded-md border border-input bg-surface-1 px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-ink-dim focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/25"
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={saveReason}
                          >
                            {t("decisionReasonSave")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingId(null);
                              setDraft("");
                            }}
                          >
                            {t("decisionReasonCancel")}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* 重新分流動作（依目前處置給不同選項） */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {disp === "skipped" && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => reclassify(tender.id, "none")}
                        >
                          <RotateCcw size={14} />
                          {t("decisionUndoDiscard")}
                        </Button>
                      )}
                      {disp !== "starred" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reclassify(tender.id, "starred")}
                        >
                          <Star size={14} />
                          {t("decisionToStarredAction")}
                        </Button>
                      )}
                      {disp !== "accepted" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reclassify(tender.id, "accepted")}
                        >
                          <Check size={14} />
                          {t("decisionToAcceptedAction")}
                        </Button>
                      )}
                      {disp !== "skipped" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reclassify(tender.id, "skipped")}
                        >
                          <X size={14} />
                          {t("decisionDiscardAction")}
                        </Button>
                      )}
                      {disp === "skipped" && !editing && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditor(tender.id)}
                        >
                          <Pencil size={14} />
                          {reason
                            ? t("decisionEditReason")
                            : t("decisionAddReason")}
                        </Button>
                      )}
                      <Link to={`/tenders/${tender.id}`} className="ml-auto">
                        <Button variant="ghost" size="sm">
                          <ExternalLink size={14} />
                          {t("decisionOpenDetail")}
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* 建議迴避字根：只就淘汰標案提供拆解入口，逐一人工確認才寫回（紅線） */}
      {skippedTenders.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,.06)]">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <Sparkles size={14} className="text-signal" aria-hidden />
            {t("decisionRootsTitle")}
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-dim">
            {t("decisionRootsHint")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {skippedTenders.map((tender) => (
              <button
                key={tender.id}
                type="button"
                onClick={() =>
                  setDlg({ tenderId: tender.id, title: tender.title })
                }
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-danger/30 bg-danger/8 px-3 py-1.5 text-[12px] font-medium text-danger transition-colors hover:bg-danger/12"
              >
                <Sparkles size={11} aria-hidden />
                <span className="truncate">{tender.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {dlg && (
        <SwipeDecisionDialog
          action="pass"
          tenderId={dlg.tenderId}
          title={dlg.title}
          onResolved={() => setDlg(null)}
        />
      )}
    </div>
  );
}
