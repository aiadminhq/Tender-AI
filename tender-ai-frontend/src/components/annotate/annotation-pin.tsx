// 已建立標註的視覺標記：依 selector 即時重新定位（捲動／改版面也能跟著元素跑）。
// 找不到對應元素時退回建立當下的 rect。
import { useEffect, useState } from "react";
import type { Annotation, AnnotationSeverity } from "@/lib/annotate/types";

const SEVERITY_DOT: Record<AnnotationSeverity, string> = {
  suggest: "bg-signal",
  important: "bg-tier-mid",
  blocker: "bg-danger",
};

function anchorOf(a: Annotation): { left: number; top: number } | null {
  let rect: { left: number; top: number } | null = null;
  try {
    const el = document.querySelector(a.selector);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) rect = { left: r.left, top: r.top };
    }
  } catch {
    /* selector 失效（DOM 已變）→ 退回 stored rect */
  }
  if (!rect && a.rect) rect = { left: a.rect.x, top: a.rect.y };
  return rect;
}

export function AnnotationPins({
  annotations,
  numberOf,
  activeId,
  onSelect,
}: {
  annotations: Annotation[];
  numberOf: (id: string) => number;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  // tick：捲動／縮放時觸發重算位置（rAF 節流）。
  const [, setTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const bump = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTick((n) => n + 1));
    };
    window.addEventListener("scroll", bump, true);
    window.addEventListener("resize", bump);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", bump, true);
      window.removeEventListener("resize", bump);
    };
  }, []);

  return (
    <>
      {annotations.map((a) => {
        const pos = anchorOf(a);
        if (!pos) return null;
        const active = a.id === activeId;
        return (
          <button
            key={a.id}
            type="button"
            data-annotate-ui
            title={a.comment}
            onClick={() => onSelect(a.id)}
            className={`fixed z-[55] grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full font-num text-[10px] font-bold text-white shadow-[0_1px_2px_rgba(0,0,0,.3)] ring-2 ring-canvas transition-transform hover:scale-110 ${SEVERITY_DOT[a.severity]} ${active ? "scale-125" : ""}`}
            style={{ left: pos.left, top: pos.top }}
          >
            {numberOf(a.id)}
          </button>
        );
      })}
    </>
  );
}
