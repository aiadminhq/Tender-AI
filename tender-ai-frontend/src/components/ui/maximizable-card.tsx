import { useEffect, useState, type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useApp } from "@/store/app-context";
import { Button } from "./button";
import { cn } from "@/lib/utils";

// 可放大卡片：平常態為一般卡殼，點右上放大鈕後全螢幕 overlay（z-40，低於 Dialog 的 z-50）。
// 支援 Esc 關閉與 body scroll-lock（沿用 sheet.tsx 的 useEffect 模式）。
export function MaximizableCard({
  title,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useApp();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!maximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximized(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [maximized]);

  const header = (
    <div className="flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-r from-surface-1/50 to-transparent">
      <div className="min-w-0 text-[15px] font-semibold tracking-tight text-ink">
        {title}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setMaximized((v) => !v)}
          title={maximized ? t("restore") : t("maximize")}
          aria-label={maximized ? t("restore") : t("maximize")}
        >
          {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </Button>
      </div>
    </div>
  );

  if (maximized) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-background p-4 sm:p-6">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-2xl">
          <div className="border-b border-border/40">{header}</div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group rounded-2xl border border-border/50 bg-gradient-to-br from-card via-card to-card/90 shadow-lg transition-all duration-300 hover:shadow-xl hover:shadow-primary/10 hover:border-border/70 hover:-translate-y-0.5",
        className,
      )}
    >
      <div className="border-b border-border/30 bg-gradient-to-r from-surface-1/40 via-transparent to-surface-1/20">
        {header}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}
