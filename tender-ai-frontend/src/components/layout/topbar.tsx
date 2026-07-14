import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Sun,
  X,
} from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandMark } from "@/components/brand";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";
import { PushBell } from "@/components/push/push-bell";
import { AnnotationToggle } from "@/components/annotate/annotation-toggle";
import { NAV } from "./nav-items";
import type { TextKey } from "@/i18n/strings";
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
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const [refreshing, setRefreshing] = useState(false);

  const activeKey = useMemo<TextKey>(() => {
    if (location.pathname === "/assistant-studio") return "navAssistantStudio";
    const exact = NAV.find((item) => item.to === location.pathname);
    if (exact) return exact.key;
    const parent = NAV.find(
      (item) => item.to !== "/" && location.pathname.startsWith(item.to),
    );
    return parent?.key ?? "appName";
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 900);
  };

  const openTenderSearch = () => {
    if (location.pathname !== "/tenders") navigate("/tenders");
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4 md:px-6">
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
          className="hidden rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground md:inline-flex"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={18} strokeWidth={1.5} />
          ) : (
            <PanelLeftClose size={18} strokeWidth={1.5} />
          )}
        </Button>

        <div className="flex min-w-0 items-center gap-2 text-[14px]">
          <span className="hidden truncate text-muted-foreground sm:inline">HQdesign</span>
          <span className="hidden text-muted-foreground sm:inline">/</span>
          <span className="truncate font-semibold text-foreground">{t(activeKey)}</span>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
        <form
          className="group relative hidden w-full max-w-[28rem] md:block"
          onSubmit={(event) => {
            event.preventDefault();
            openTenderSearch();
          }}
        >
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary"
          />
          <Input
            ref={searchRef}
            name="global-search"
            value={filter.query}
            onChange={(event) => setFilter({ query: event.target.value })}
            placeholder={t("search")}
            aria-label={t("search")}
            className="h-9 rounded-md border-input bg-muted pl-9 pr-20 text-[13px] shadow-none transition-[background-color,border-color,box-shadow] focus-visible:border-primary focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/20"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
            {filter.query ? (
              <button
                type="button"
                onClick={() => setFilter({ query: "" })}
                aria-label={t("clearSearch")}
                className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X size={14} />
              </button>
            ) : (
              <kbd className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground group-focus-within:hidden">
                ⌘ K
              </kbd>
            )}
            <button
              type="submit"
              aria-label={t("search")}
              className={cn(
                "grid size-6 place-items-center rounded text-muted-foreground transition-all",
                filter.query
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "opacity-0 group-focus-within:opacity-100",
              )}
            >
              <ArrowRight size={14} />
            </button>
          </div>
        </form>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            aria-label={t("refresh")}
            title={refreshing ? t("refreshing") : t("refresh")}
            className="rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
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
            aria-label={t("toggleTheme")}
            title={t("toggleTheme")}
            className="rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
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
            aria-label={t("toggleLang")}
            title={t("toggleLang")}
            className="rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <span className="text-[11px] font-semibold">{lang === "zh" ? "EN" : "中"}</span>
          </Button>
          {import.meta.env.DEV && <AnnotationToggle />}
          <PushBell />
          {location.pathname !== "/assistant-studio" && <AssistantLauncher />}
        </div>
      </div>
    </header>
  );
}
