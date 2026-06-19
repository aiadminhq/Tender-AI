// 多來源連線狀態：精簡列表（小圓點 + shortName + 狀態 Badge）。
// 由 sidebar 移出,現作為 /settings「來源管理」卡片內容。
import { useApp } from "@/store/app-context";
import { SOURCES } from "@/data/sources";
import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";
import type { ConnectorState } from "@/types/domain";
import { cn } from "@/lib/utils";

const dotByState: Record<ConnectorState, string> = {
  connected: "bg-tier-high",
  unbound: "bg-ink-dim",
  failed: "bg-tier-low",
  offline: "bg-tier-mid",
};

const badgeByState: Record<ConnectorState, BadgeProps["variant"]> = {
  connected: "success",
  unbound: "muted",
  failed: "danger",
  offline: "default",
};

export function SourceStatusList() {
  const { t } = useApp();

  return (
    <ul className="space-y-1.5">
      {SOURCES.map((s) => (
        <li
          key={s.key}
          className="flex items-center gap-2.5 rounded-md px-1 py-1 text-[12px]"
        >
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full", dotByState[s.state])}
          />
          <span className="truncate font-medium text-ink">{s.shortName}</span>
          <Badge variant={badgeByState[s.state]} className="ml-auto shrink-0">
            {t(s.state)}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
