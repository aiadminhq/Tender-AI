import { useState } from "react";
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
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 900);
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-canvas/85 px-4 backdrop-blur md:px-6">
      <div className="md:hidden">
        <BrandMark size={24} />
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        aria-label={t(sidebarCollapsed ? "expandSidebar" : "collapseSidebar")}
        title={t(sidebarCollapsed ? "expandSidebar" : "collapseSidebar")}
        className="hidden md:inline-flex"
      >
        {sidebarCollapsed ? (
          <PanelLeftOpen size={16} />
        ) : (
          <PanelLeftClose size={16} />
        )}
      </Button>

      <div className="relative max-w-md flex-1">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim"
        />
        <Input
          value={filter.query}
          onChange={(e) => setFilter({ query: e.target.value })}
          placeholder={t("search")}
          className="pl-9"
        />
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={refresh}
          aria-label={t("refresh")}
          title={refreshing ? t("refreshing") : t("refresh")}
        >
          <RefreshCw size={16} className={cn(refreshing && "animate-spin")} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label={t("theme")}
          title={t("theme")}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleLang}
          aria-label={t("language")}
          title={t("language")}
        >
          <span className="text-[11px] font-semibold">
            {lang === "zh" ? "EN" : "中"}
          </span>
        </Button>
        {/* 設計標註工具（dev-only，正式 build 不含） */}
        {import.meta.env.DEV && <AnnotationToggle />}
        <PushBell />
        <AssistantLauncher />
        <AccountMenu />
      </div>
    </header>
  );
}
