import {
  ArrowRight,
  Check,
  Download,
  MessageSquare,
  Send,
  SlidersHorizontal,
  StickyNote,
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
  note: { icon: StickyNote, cls: "text-signal", zh: "標註", en: "annotated" },
  forward: { icon: Send, cls: "text-priority", zh: "轉傳", en: "forwarded" },
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
        <ul className="space-y-3">
          {items.map((a) => {
            const m = kindMap[a.kind];
            const Icon = m.icon;
            const name = userById(a.userId)?.name ?? a.userId;
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
