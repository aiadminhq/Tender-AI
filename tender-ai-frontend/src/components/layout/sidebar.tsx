import { NavLink, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  ChevronDown,
  LogOut,
  Palette,
  Search,
  Settings,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { useAuth } from "@/store/auth-context";
import { USERS } from "@/data/users";
import type { TaskStatus } from "@/types/domain";
import type { TextKey } from "@/i18n/strings";
import { BrandMark } from "@/components/brand";
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
      end={item.to === "/"}
      className={({ isActive }) =>
        cn(
          "group flex items-center justify-between rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-all duration-200",
          isActive
            ? "bg-ink/6 text-ink shadow-[inset_0_0_0_1px_rgba(0,0,0,0.02)]"
            : "text-ink-muted hover:bg-ink/5 hover:text-ink",
        )
      }
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon
          size={16}
          strokeWidth={1.6}
          className="shrink-0 text-current opacity-75"
        />
        <span className="truncate tracking-wide">{t(item.key)}</span>
      </span>
      {(meta?.count !== undefined || meta?.tag) && (
        <span
          className={cn(
            "ml-2 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
            meta.count !== undefined
              ? "bg-ink/6 text-ink-muted"
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
  const { logout } = useAuth();
  const navigate = useNavigate();

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
        "hidden h-svh shrink-0 overflow-hidden border-r border-border/60 bg-card/65 transition-[width,opacity] duration-300 ease-out md:flex md:flex-col",
        sidebarCollapsed ? "w-0 border-r-0 opacity-0" : "w-[260px] opacity-100",
      )}
    >
      <div className="flex h-full w-[260px] flex-col p-3">
        <button
          type="button"
          onClick={() => navigate("/settings")}
          className="group mb-4 flex items-center justify-between rounded-lg bg-ink/5 px-2 py-2 text-left transition-colors hover:bg-ink/7"
        >
          <span className="flex min-w-0 items-center gap-3">
            <BrandMark size={32} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold leading-none text-ink">
                {t("appName")}
              </span>
              <span className="mt-1 block truncate text-[11px] leading-none text-ink-muted">
                {t("appSub")}
              </span>
            </span>
          </span>
          <ChevronDown
            size={16}
            strokeWidth={1.5}
            className="shrink-0 text-ink-dim transition-colors group-hover:text-ink-muted"
          />
        </button>

        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV_GROUPS.map((group, index) => (
            <div key={index} className="flex flex-col gap-0.5">
              {group.heading && (
                <span className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
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

          <div className="rounded-lg border border-border/50 bg-surface-1/70 p-3">
            <div className="flex items-center gap-2">
              <Activity size={14} strokeWidth={1.8} className="text-ink-dim" />
              <span className="text-[12px] font-medium text-ink">
                {t("sprint")}
              </span>
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-signal/10 px-1.5 py-0.5 text-[11px] font-medium text-signal">
                <TrendingUp size={11} strokeWidth={2.2} />
                <span className="tnum">{sprintPct}%</span>
              </span>
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/8"
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
              <span className="tnum text-ink-muted">
                {metrics.kpiInProgress}
              </span>
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
        </nav>

        <div className="mt-4 border-t border-border/60 pt-3">
          {/* 設計系統呈現頁：dev-only 入口（與 App.tsx route gate 一致；正式 build 不顯示） */}
          {import.meta.env.DEV && (
            <SidebarLink
              item={{
                to: "/design-system",
                key: "navDesignSystem",
                icon: Palette,
              }}
              meta={{ tag: "dev" }}
            />
          )}
          {/* 小助手替代方案 mockup：dev-only，獨立於現有 /assistant。 */}
          {import.meta.env.DEV && (
            <SidebarLink
              item={{
                to: "/assistant-studio",
                key: "navAssistantStudio",
                icon: Sparkles,
              }}
              meta={{ tag: "mock" }}
            />
          )}
          {/* 圖表藝廊：dev-only 入口（與 App.tsx route gate 一致；正式 build 不顯示） */}
          {import.meta.env.DEV && (
            <SidebarLink
              item={{ to: "/charts", key: "navCharts", icon: BarChart3 }}
              meta={{ tag: "dev" }}
            />
          )}
          <SidebarLink item={NAV[NAV.length - 1]} icon={Settings} />
          <button
            type="button"
            onClick={logout}
            className="mt-0.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left text-[13px] font-medium text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <LogOut size={16} strokeWidth={1.6} className="opacity-75" />
            <span>{t("accountMenuLogout")}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
