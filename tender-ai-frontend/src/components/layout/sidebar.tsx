import { NavLink } from "react-router-dom";
import { Activity, TrendingUp } from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { USERS } from "@/data/users";
import type { TaskStatus } from "@/types/domain";
import { BrandMark } from "@/components/brand";
import { NAV } from "./nav-items";
import { cn } from "@/lib/utils";

// 衝刺進度：依任務狀態推進程度加權平均（拖曳卡片會即時反映）
const SPRINT_WEIGHT: Record<TaskStatus, number> = {
  todo: 0,
  doing: 0.4,
  review: 0.75,
  done: 1,
};

export function Sidebar() {
  const { t, sidebarCollapsed } = useApp();
  const { cards, filteredTenders, metrics } = useAppData();

  const sprintPct = cards.length
    ? Math.round(
        (cards.reduce((sum, c) => sum + SPRINT_WEIGHT[c.status], 0) /
          cards.length) *
          100,
      )
    : 0;
  const blockedCount = cards.filter((c) => c.blockReason).length;

  const navMeta: Record<string, { count?: number; tag?: string }> = {
    "/": { tag: t("today") },
    "/tenders": { count: filteredTenders.length },
    "/kanban": { count: cards.length },
    "/rules": { tag: t("focusAvoid") },
  };

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-border bg-surface-1 transition-[width] duration-200 md:flex",
        sidebarCollapsed ? "w-16" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2.5 border-b border-border",
          sidebarCollapsed ? "justify-center px-2" : "px-5",
        )}
      >
        <BrandMark size={28} />
        {!sidebarCollapsed && (
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-tight text-ink">
              {t("appName")}
            </div>
            <div className="truncate text-[11px] text-ink-dim">
              {t("appSub")}
            </div>
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3">
        {NAV.map((item) => {
          const meta = navMeta[item.to];
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              title={sidebarCollapsed ? t(item.key) : undefined}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
                  sidebarCollapsed && "justify-center px-0",
                  isActive
                    ? "bg-accent text-ink"
                    : "text-ink-muted hover:bg-accent hover:text-ink",
                )
              }
            >
              <item.icon size={17} strokeWidth={2} />
              {!sidebarCollapsed && (
                <>
                  <span className="flex-1 truncate">{t(item.key)}</span>
                  {meta?.count !== undefined && (
                    <span className="tnum shrink-0 text-[11px] text-ink-dim">
                      {meta.count}
                    </span>
                  )}
                  {meta?.tag && (
                    <span className="shrink-0 text-[10px] text-ink-dim">
                      {meta.tag}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {!sidebarCollapsed && (
        <div className="border-t border-border px-4 py-3.5">
          <div className="flex items-center gap-2">
            <Activity size={14} strokeWidth={2} className="text-ink-dim" />
            <span className="text-[12px] font-medium text-ink">
              {t("sprint")}
            </span>
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-medium text-signal">
              <TrendingUp size={11} strokeWidth={2.2} />
              <span className="tnum">{sprintPct}%</span>
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent"
            role="img"
            aria-label={`${t("sprint")} ${sprintPct}%`}
          >
            <div
              className="h-full rounded-full bg-signal transition-[width] duration-500"
              style={{ width: `${sprintPct}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink-dim">
            <span className="tnum text-ink-muted">{USERS.length}</span>
            <span>{t("teamMembers")}</span>
            <span className="text-border">·</span>
            <span className="tnum text-ink-muted">{metrics.kpiInProgress}</span>
            <span>{t("kpiInProgress")}</span>
            {blockedCount > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="tnum text-tier-low">{blockedCount}</span>
                <span className="text-tier-low">{t("blocked")}</span>
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
