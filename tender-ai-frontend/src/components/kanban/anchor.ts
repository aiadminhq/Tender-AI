// 浮層定位小工具：依觸發按鈕的位置算出 fixed 定位座標（右緣防溢出）。
// 抽出自 kanban-card.tsx 的 anchorBelow，供 AssigneeMenu 等多個看板浮層共用。
export type Anchor = { top: number; left: number };

export function anchorBelow(
  el: HTMLElement | null,
  width: number,
): Anchor | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.bottom + 6,
    left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)),
  };
}
