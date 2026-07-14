import { NavLink, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  ChevronDown,
  Palette,
  Search,
  Settings,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { USERS } from "@/data/users";
import type { TaskStatus } from "@/types/domain";
import type { TextKey } from "@/i18n/strings";
import { BrandMark } from "@/components/brand";
import { AccountMenu } from "./account-menu";
import { NAV, type NavItem } from "./nav-items";
import { cn } from "@/lib/utils";

const SPRINT_WEIGHT: Record<TaskStatus, number> = {
  todo: 0,
  doing: 0.4,
  review: 0.75,
  done: 1,
};

const NAV_GROUPS: { heading?: TextKey; items: NavItem[] }[] = [
  { items: NAV.slice(0, 5) },
  { heading: "filters", items: NAV.slice(5, 9) },
  { heading: "sprint", items: NAV.slice(9, -1) },
];

function SidebarLink({
  item,
  icon: Icon = item.icon,
  meta,
}: {
  item: NavItem;
  icon?: LucideIcon;
  meta?: { count?: number; tag?: string };
}) {
  const { t } = useApp();
  return (
    <NavLink
      to={item.to}
      end={item.to === "/" || item.to === "/settings"}
      className={({ isActive }) =>
        cn(
          "group flex items-center justify-between rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors duration-150",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--primary)]"
            : "text-sidebar-foreground/70 hover:bg-card hover:text-sidebar-foreground",
        )
      }
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon size={16} strokeWidth={1.6} className="shrink-0" />
        <span className="truncate">{t(item.key)}</span>
      </span>
      {(meta?.count !== undefined || meta?.tag) && (
        <span
          className={cn(
            "ml-2 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
            meta.count !== undefined
              ? "bg-sidebar-primary/10 text-sidebar-accent-foreground"
              : "text-ink-dim",
          )}
        >
          {meta.count ?? meta.tag}
        </span>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const { t, sidebarCollapsed } = useApp();
  const { cards, filteredTenders, metrics } = useAppData();
  const navigate = useNavigate();
  const sprintPct = cards.length
    ? Math.round(
        (cards.reduce((sum, card) => sum + SPRINT_WEIGHT[card.status], 0) /
          cards.length) *
          100,
      )
    : 0;
  const blockedCount = cards.filter((card) => card.blockReason).length;
  const navMeta: Record<string, { count?: number; tag?: string }> = {
    "/": { tag: t("today") },
    "/tenders": { count: filteredTenders.length },
    "/kanban": { count: cards.length },
    "/rules": { tag: t("focusAvoid") },
  };

  return (
    <aside
      className={cn(
        "hidden h-svh shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width,opacity] duration-300 ease-out md:flex md:flex-col",
        sidebarCollapsed ? "w-0 border-r-0 opacity-0" : "w-64 opacity-100",
      )}
    >
      <div className="flex h-full w-64 flex-col p-3">
        <button
          type="button"
          onClick={() => navigate("/settings")}
          className="group mb-5 flex items-center justify-between rounded-md border border-sidebar-border bg-card px-2.5 py-2.5 text-left shadow-xs transition-colors hover:bg-sidebar-accent"
        >
          <span className="flex min-w-0 items-center gap-3">
            <BrandMark size={30} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold leading-none text-sidebar-foreground">
                {t("appName")}
              </span>
              <span className="mt-1 block truncate text-[11px] leading-none text-muted-foreground">
                {t("appSub")}
              </span>
            </span>
          </span>
          <ChevronDown
            size={15}
            strokeWidth={1.5}
            className="shrink-0 text-muted-foreground transition-colors group-hover:text-sidebar-accent-foreground"
          />
        </button>

        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV_GROUPS.map((group, index) => (
            <div key={index} className="flex flex-col gap-0.5">
              {group.heading && (
                <span className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {t(group.heading)}
                </span>
              )}
              {group.items.map((item) => (
                <SidebarLink
                  key={item.to}
                  item={item}
                  icon={item.to === "/search" ? Search : item.icon}
                  meta={navMeta[item.to]}
                />
              ))}
            </div>
          ))}

          <div className="rounded-md border border-sidebar-border bg-card p-3 shadow-xs">
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-muted-foreground" />
              <span className="text-[12px] font-medium text-sidebar-foreground">
                {t("sprint")}
              </span>
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-accent-foreground">
                <TrendingUp size={11} strokeWidth={2} />
                <span className="tnum">{sprintPct}%</span>
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${sprintPct}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-1.5 text-[10px] text-muted-foreground">
              <span className="tnum text-sidebar-foreground">{USERS.length}</span>
              <span>{t("teamMembers")}</span>
              <span>·</span>
              <span className="tnum text-sidebar-foreground">{metrics.kpiInProgress}</span>
              <span>{t("kpiInProgress")}</span>
              {blockedCount > 0 && <span className="text-destructive">· {blockedCount} {t("blocked")}</span>}
            </div>
          </div>
        </nav>

        <div className="mt-4 border-t border-sidebar-border pt-3">
          {import.meta.env.DEV && (
            <SidebarLink item={{ to: "/design-system", key: "navDesignSystem", icon: Palette }} meta={{ tag: "dev" }} />
          )}
          {import.meta.env.DEV && (
            <SidebarLink item={{ to: "/assistant-studio", key: "navAssistantStudio", icon: Sparkles }} meta={{ tag: "mock" }} />
          )}
          {import.meta.env.DEV && (
            <SidebarLink item={{ to: "/charts", key: "navCharts", icon: BarChart3 }} meta={{ tag: "dev" }} />
          )}
          <SidebarLink item={NAV[NAV.length - 1]} icon={Settings} />
          <AccountMenu variant="sidebar" />
        </div>
      </div>
    </aside>
  );
}
