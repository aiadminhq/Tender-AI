// 投標階段徽章（仿 TierBadge）：五階段 1:1 對齊後端 TenderUserState.status。
// 不靠純色傳意——永遠附文字（a11y）。STAGE_LABEL_KEY 供工具列/欄頭共用文案鍵。
import { cn } from "@/lib/utils";
import type { BidStage } from "@/types/domain";
import { STRINGS, type Lang, type TextKey } from "@/i18n/strings";

/** 階段 → i18n 文案鍵（觀望/備標中/已投標/得標/放棄）。 */
export const STAGE_LABEL_KEY: Record<BidStage, TextKey> = {
  watching: "stageWatching",
  preparing: "stagePreparing",
  submitted: "stageSubmitted",
  won: "stageWon",
  abandoned: "stageAbandoned",
};

// 五色由中性→藍→琥珀→綠→紅，沿用既有 token，不自創色。
const stageMap: Record<BidStage, { cls: string; dot: string }> = {
  watching: { cls: "bg-surface-2 text-ink-muted", dot: "bg-ink-dim" },
  preparing: { cls: "bg-signal/12 text-signal", dot: "bg-signal" },
  submitted: { cls: "bg-tier-mid/12 text-tier-mid", dot: "bg-tier-mid" },
  won: { cls: "bg-success/12 text-success", dot: "bg-success" },
  abandoned: { cls: "bg-danger/12 text-danger", dot: "bg-danger" },
};

export function StageBadge({
  stage,
  lang,
  className,
}: {
  stage: BidStage;
  lang: Lang;
  className?: string;
}) {
  const m = stageMap[stage];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
        m.cls,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {STRINGS[lang][STAGE_LABEL_KEY[stage]]}
    </span>
  );
}
