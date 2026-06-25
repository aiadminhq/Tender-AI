import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Sun,
} from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandMark } from "@/components/brand";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";
import { PushBell } from "@/components/push/push-bell";
import { AnnotationToggle } from "@/components/annotate/annotation-toggle";
import { AccountMenu } from "./account-menu";
import { NAV } from "./nav-items";
import { cn } from "@/lib/utils";

export function Topbar() {
  const {
    t,
    theme,
    toggleTheme,
    lang,
    toggleLang,
    sidebarCollapsed,
    toggleSidebar,
  } = useApp();
  const { filter, setFilter } = useAppData();
  const location = useLocation();
  const [refreshing, setRefreshing] = useState(false);

  const activeItem = useMemo(() => {
    const exact = NAV.find((item) => item.to === location.pathname);
    if (exact) return exact;
    return NAV.find(
      (item) => item.to !== "/" && location.pathname.startsWith(item.to),
    );
  }, [location.pathname]);

  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 900);
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border/60 bg-card/90 px-4 backdrop-blur md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="md:hidden">
          <BrandMark size={30} />
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label={t(sidebarCollapsed ? "expandSidebar" : "collapseSidebar")}
          title={t(sidebarCollapsed ? "expandSidebar" : "collapseSidebar")}
          className="hidden rounded-md text-ink-muted hover:bg-ink/5 hover:text-ink md:inline-flex"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={18} strokeWidth={1.5} />
          ) : (
            <PanelLeftClose size={18} strokeWidth={1.5} />
          )}
        </Button>

        <div className="flex min-w-0 items-center gap-2 text-[14px]">
          <span className="hidden truncate text-ink-muted sm:inline">
            HQdesign
          </span>
          <span className="hidden text-ink-dim sm:inline">/</span>
          <span className="truncate font-semibold text-ink">
            {activeItem ? t(activeItem.key) : t("appName")}
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
        <div className="relative hidden w-full max-w-[34rem] md:block">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-dim"
          />
          <Input
            value={filter.query}
            onChange={(e) => setFilter({ query: e.target.value })}
            placeholder={t("search")}
            className="h-10 rounded-lg border-transparent bg-ink/5 pl-10 text-[13px] shadow-none focus-visible:border-ring/30 focus-visible:bg-card focus-visible:ring-ring/20"
          />
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            aria-label={t("refresh")}
            title={refreshing ? t("refreshing") : t("refresh")}
            className="rounded-md text-ink-muted hover:bg-ink/5 hover:text-ink"
          >
            <RefreshCw
              size={17}
              strokeWidth={1.6}
              className={cn(refreshing && "animate-spin")}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={t("theme")}
            title={t("theme")}
            className="rounded-md text-ink-muted hover:bg-ink/5 hover:text-ink"
          >
            {theme === "dark" ? (
              <Sun size={17} strokeWidth={1.6} />
            ) : (
              <Moon size={17} strokeWidth={1.6} />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleLang}
            aria-label={t("language")}
            title={t("language")}
            className="rounded-md text-ink-muted hover:bg-ink/5 hover:text-ink"
          >
            <span className="text-[11px] font-semibold">
              {lang === "zh" ? "EN" : "中"}
            </span>
          </Button>
          {import.meta.env.DEV && <AnnotationToggle />}
          <PushBell />
          <AssistantLauncher />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
