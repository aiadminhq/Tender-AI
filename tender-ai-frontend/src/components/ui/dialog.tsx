import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// 置中彈窗（無 radix 依賴）。Esc / 點背景關閉。
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = "sm:max-w-5xl",
  surfaceClassName = "bg-card",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  /** 彈窗面板底色（預設白卡 bg-card；房規：不用灰底 bg-popover）。 */
  surfaceClassName?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/55 animate-in fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          // 手機用 dvh（可視高度，避開 iOS Safari 網址列造成的 vh 溢出）；手機留白略收。
          "relative flex max-h-[92dvh] w-full max-w-[95vw] flex-col rounded-xl border border-border shadow-[var(--elev-overlay)] animate-in fade-in zoom-in-95 duration-200 ease-out",
          surfaceClassName,
          width,
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5 sm:py-4">
          <div className="min-w-0 text-[15px] font-semibold tracking-tight text-foreground">
            {title}
          </div>
          <button
            onClick={onClose}
            aria-label="關閉"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-accent hover:text-foreground"
          >
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {children}
        </div>
        {footer && (
          <footer className="border-t border-border px-4 py-3 sm:px-5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
