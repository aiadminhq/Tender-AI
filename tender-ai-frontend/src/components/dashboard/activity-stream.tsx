import {
  ArrowRight,
  Check,
  Download,
  MessageSquare,
  Scale,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { ACTIVITY } from "@/data/activity";
import { userById } from "@/data/users";
import { formatRelative } from "@/lib/format";
import type { ActivityKind } from "@/types/domain";
import { cn } from "@/lib/utils";

const kindMap: Record<
  ActivityKind,
  { icon: LucideIcon; cls: string; zh: string; en: string }
> = {
  accept: { icon: Check, cls: "text-tier-high", zh: "承接", en: "accepted" },
  skip: { icon: X, cls: "text-ink-dim", zh: "略過", en: "skipped" },
  comment: {
    icon: MessageSquare,
    cls: "text-signal",
    zh: "評論",
    en: "commented on",
  },
  move: { icon: ArrowRight, cls: "text-priority", zh: "移動", en: "moved" },
  import: { icon: Download, cls: "text-ink-muted", zh: "匯入", en: "imported" },
  rule: {
    icon: SlidersHorizontal,
    cls: "text-tier-mid",
    zh: "更新",
    en: "tuned",
  },
  judge: { icon: Scale, cls: "text-signal", zh: "判斷", en: "judged" },
};

const DEMO_ACTIVITY_IDS = new Set(ACTIVITY.map((item) => item.id));
const TEAM_PROGRESS_KINDS = new Set<ActivityKind>(["accept", "comment"]);

export function ActivityStream({ limit = 8 }: { limit?: number }) {
  const { t, lang } = useApp();
  const { activity, memberById, usingLiveData } = useAppData();
  const items = activity
    .filter((item) => TEAM_PROGRESS_KINDS.has(item.kind))
    .filter((item) => !usingLiveData || !DEMO_ACTIVITY_IDS.has(item.id))
    .slice(0, limit);

  return (
    <div>
      {items.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-ink-dim">
          {usingLiveData
            ? t("teamProgressUnavailable")
            : t("noTeamProgress")}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => {
            const m = kindMap[a.kind];
            const Icon = m.icon;
            const numericMemberId = Number(a.userId);
            const name =
              userById(a.userId)?.name ??
              (Number.isSafeInteger(numericMemberId)
                ? memberById(numericMemberId)?.name
                : undefined) ??
              a.userId;
            return (
              <li key={a.id} className="flex gap-3">
                <span
                  className={cn(
                    "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2",
                    m.cls,
                  )}
                >
                  <Icon size={14} strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] leading-snug">
                    <span className="font-medium text-ink">{name}</span>{" "}
                    <span className="text-ink-muted">
                      {lang === "en" ? m.en : m.zh}
                    </span>{" "}
                    {a.target && <span className="text-ink">{a.target}</span>}
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-dim">
                    {formatRelative(a.at, lang)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
