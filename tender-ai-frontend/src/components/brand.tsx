// 品牌標記：瞄準鏡 target glyph（對應「投標作戰台」鎖定案源的語意）。
// 純 SVG、用色取設計 token（signal 藍）。
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect
        width="28"
        height="28"
        rx="8"
        fill="var(--signal)"
        fillOpacity="0.12"
      />
      <circle cx="14" cy="14" r="7" stroke="var(--signal)" strokeWidth="1.6" />
      <circle cx="14" cy="14" r="2.4" fill="var(--signal)" />
      <path
        d="M14 3.75v3.1M14 21.15v3.1M3.75 14h3.1M21.15 14h3.1"
        stroke="var(--signal)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
