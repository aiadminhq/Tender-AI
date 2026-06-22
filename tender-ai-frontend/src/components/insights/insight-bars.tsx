import { BarChart3 } from "lucide-react";
import { useApp } from "@/store/app-context";

// 水平長條圖：用於「各類別預算規模」等金額型維度。
// 條長 = frac（0..1）對應的百分比寬度；右上標金額與佔比。
// note 欄為選用，供承標判準訊號（lift/樣本數）就地標註，無後端時不顯示。
export interface BarRow {
  key: string;
  label: string;
  color: string;
  /** 長條寬度比例（0..1，通常為金額佔比） */
  frac: number;
  /** 已在地化的金額字串 */
  valueLabel: string;
  /** 整數百分比 */
  pct: number;
  /** 選用註記（如：偏好傾向 +18%） */
  note?: string;
}

export function InsightBars({ rows }: { rows: BarRow[] }) {
  const { t } = useApp();
  const hasValue = rows.some((r) => r.frac > 0);

  if (!hasValue) {
    return (
      <div className="flex flex-col items-center justify-center gap-2.5 py-10 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full border-2 border-dashed border-hairline">
          <BarChart3 size={20} strokeWidth={1.5} className="text-ink-dim" />
        </div>
        <p className="text-[13px] font-medium text-ink">{t("emptyTitle")}</p>
        <p className="max-w-[220px] text-[12px] text-ink-dim">
          {t("emptyHint")}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1.5 flex items-baseline gap-2 text-[13px]">
            <span className="text-ink-muted">{r.label}</span>
            <span className="tnum ml-auto font-medium text-ink">
              {r.valueLabel}
            </span>
            <span className="tnum w-9 text-right text-xs text-ink-dim">
              {r.pct}%
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{
                width: `${Math.max(r.frac * 100, r.frac > 0 ? 2 : 0)}%`,
                background: r.color,
              }}
            />
          </div>
          {r.note && <p className="mt-1 text-[11px] text-ink-dim">{r.note}</p>}
        </li>
      ))}
    </ul>
  );
}
