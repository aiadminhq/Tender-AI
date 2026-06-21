import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// 自寫無 radix 浮層：透過 portal 掛到 body，fixed 定位，避免被看板欄位的
// 圓角／overflow 裁切。錨定在觸發元素下方，空間不足時往上翻；對齊起始或結束邊。
// 點擊外部（含觸發鈕）或 Esc 關閉。
export function AnchoredPopover({
  anchorRef,
  open,
  onClose,
  align = "start",
  width = 264,
  className,
  children,
  label,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  align?: "start" | "end";
  width?: number;
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    placement: "bottom" | "top";
  } | null>(null);

  // 量測並計算定位（開啟、捲動、視窗縮放時重算）。
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      if (!a) return;
      const margin = 8;
      const panelH = panelRef.current?.offsetHeight ?? 0;
      const below = window.innerHeight - a.bottom;
      const placement: "bottom" | "top" =
        below < panelH + margin && a.top > below ? "top" : "bottom";
      const top =
        placement === "bottom" ? a.bottom + 6 : a.top - panelH - 6;
      let left = align === "end" ? a.right - width : a.left;
      // 夾在視窗內，避免溢出左右邊。
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
      setPos({ top, left, placement });
    };
    place();
    // 第二次量測：拿到 panel 實際高度後校正向上翻的情形。
    const raf = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, align, width, anchorRef]);

  // 外部點擊 / Esc 關閉。
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        visibility: pos ? "visible" : "hidden",
      }}
      className={cn(
        "z-50 rounded-lg border border-border bg-popover p-2 text-ink shadow-[0_1px_2px_rgba(0,0,0,.06)] outline outline-1 outline-black/[.02] animate-in fade-in",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
