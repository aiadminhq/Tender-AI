import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";

// 近 7 日新案趨勢：漸層面積折線圖。
// SVG 以 preserveAspectRatio=none 拉伸填滿卡片寬度；stroke 用 non-scaling
// 保持 2px 銳利；末日點改用 HTML 正圓定位，避免在拉伸座標系下變成橢圓。
export function TrendChart() {
  const { t, lang } = useApp();
  const { trend7d } = useAppData();

  const n = trend7d.length;
  // 空資料守衛：n===0 時 pts[n-1] 為 undefined，後續取 .x/.v 會丟 TypeError 崩潰。
  if (n === 0) {
    return (
      <div className="flex h-28 items-center justify-center text-[12px] text-ink-dim">
        {t("noData")}
      </div>
    );
  }
  const max = Math.max(...trend7d, 1);
  const fmt = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "zh-TW", {
    month: "numeric",
    day: "numeric",
  });
  const today = new Date();

  // viewBox 0..100 × 0..100；TOP/BOTTOM 留白避免峰值與基線貼邊，PAD_X 防端點裁切。
  const PAD_X = 1.5;
  const TOP = 14;
  const BOTTOM = 6;
  const pts = trend7d.map((v, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (n - 1 - i));
    return {
      x: PAD_X + (n === 1 ? 0 : i / (n - 1)) * (100 - PAD_X * 2),
      y: TOP + (1 - v / max) * (100 - TOP - BOTTOM),
      v,
      label: fmt.format(d),
    };
  });

  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`)
    .join(" ");
  const area = `${line} L${pts[n - 1].x} 100 L${pts[0].x} 100 Z`;
  const last = pts[n - 1];

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-end gap-2">
        <span className="text-[11px] text-ink-dim">
          <span className="tnum font-medium text-signal">{last.v}</span>{" "}
          {t("today")}
        </span>
      </div>

      <div className="relative h-28">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
          role="img"
          aria-label={`${t("trend7d")}: ${trend7d.join(", ")}`}
        >
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                style={{ stopColor: "var(--color-signal)", stopOpacity: 0.24 }}
              />
              <stop
                offset="100%"
                style={{ stopColor: "var(--color-signal)", stopOpacity: 0.02 }}
              />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#trendFill)" />
          <path
            d={line}
            fill="none"
            className="stroke-signal"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal ring-2 ring-card"
          style={{ left: `${last.x}%`, top: `${last.y}%` }}
          aria-hidden
        />
      </div>

      <div className="mt-2 flex justify-between">
        {pts.map((p, i) => (
          <span key={i} className="tnum text-[9px] text-ink-dim">
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}
