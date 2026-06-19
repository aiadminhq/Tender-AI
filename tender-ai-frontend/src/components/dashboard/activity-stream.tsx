import {
  ArrowRight,
  Check,
  Download,
  MessageSquare,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
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
  comment: { icon: MessageSquare, cls: "text-signal", zh: "註記", en: "noted" },
  move: { icon: ArrowRight, cls: "text-priority", zh: "移動", en: "moved" },
  import: { icon: Download, cls: "text-ink-muted", zh: "匯入", en: "imported" },
  rule: {
    icon: SlidersHorizontal,
    cls: "text-tier-mid",
    zh: "更新",
    en: "tuned",
  },
};

export function ActivityStream({ limit = 8 }: { limit?: number }) {
  const { t, lang } = useApp();
  const { activity } = useAppData();
  const items = activity.slice(0, limit);

  return (
    <div>
      {items.length === 0 ? (
        <p className="text-[12px] text-ink-dim">{t("noActivity")}</p>
      ) : (
        <ul className="space-y-3.5">
          {items.map((a, idx) => {
            const m = kindMap[a.kind];
            const Icon = m.icon;
            const name = userById(a.userId)?.name ?? a.userId;
            return (
              <li
                key={a.id}
                className="group flex gap-3 rounded-lg p-2.5 transition-all duration-200 hover:bg-surface-1/40"
              >
                <span
                  className={cn(
                    "mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg font-semibold transition-transform duration-200 group-hover:scale-110",
                    m.cls,
                    a.kind === "accept" && "bg-tier-high/12",
                    a.kind === "skip" && "bg-surface-2",
                    a.kind === "comment" && "bg-signal/12",
                    a.kind === "move" && "bg-priority/12",
                    a.kind === "import" && "bg-surface-2",
                    a.kind === "rule" && "bg-tier-mid/12",
                  )}
                >
                  <Icon size={16} strokeWidth={2.2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium leading-tight">
                    <span className="text-ink">{name}</span>{" "}
                    <span className={cn("font-normal", m.cls)}>
                      {lang === "en" ? m.en : m.zh}
                    </span>{" "}
                    {a.target && (
                      <span className="text-ink-muted text-[12px]">
                        {a.target}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 text-[11px] text-ink-dim">
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
