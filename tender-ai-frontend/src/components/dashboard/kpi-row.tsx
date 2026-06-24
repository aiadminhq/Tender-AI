import {
  Activity,
  CircleCheck,
  Clock,
  Flame,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useApp } from "@/store/app-context";
import { useAppData, type Metrics } from "@/store/app-data";
import type { TextKey } from "@/i18n/strings";
import { BarSpark, LineSpark, StreakDots } from "@/components/ui/sparkline";
import { KpiCard, type KpiAccent } from "./kpi-card";

interface KpiDef {
  key: TextKey;
  metric: keyof Metrics;
  icon: LucideIcon;
  accent: KpiAccent;
  /** 趨勢百分比（示意，待接真實時序資料後改由後端供給）。 */
  delta?: number;
  /** 迷你趨勢圖；接收當前值以呈現 streak（示意資料）。 */
  spark?: (value: number) => ReactNode;
}

// 註：以下 spark/delta 皆為「示意」資料——目前 metrics 無時序欄位，
// 比照 /knowvio 參考頁先給靜態趨勢，待後端補上歷史序列再換真實值。
const KPIS: KpiDef[] = [
  {
    key: "kpiNew",
    metric: "kpiNew",
    icon: Inbox,
    accent: "signal",
    delta: 12,
    spark: () => <BarSpark data={[10, 16, 12, 22, 18, 28, 24, 34]} />,
  },
  {
    key: "kpiHigh",
    metric: "kpiHigh",
    icon: Flame,
    accent: "high",
    delta: 8,
    spark: () => <LineSpark data={[6, 9, 7, 12, 10, 15, 14, 18]} />,
  },
  {
    key: "kpiClosing",
    metric: "kpiClosing",
    icon: Clock,
    accent: "low",
    delta: -5,
    spark: () => <BarSpark data={[20, 18, 22, 16, 14, 12, 10, 8]} />,
  },
  {
    key: "kpiInProgress",
    metric: "kpiInProgress",
    icon: Activity,
    accent: "priority",
    delta: 6,
    spark: () => <LineSpark data={[4, 5, 7, 6, 9, 8, 11, 12]} />,
  },
  {
    key: "kpiAccepted",
    metric: "kpiAccepted",
    icon: CircleCheck,
    accent: "high",
    spark: (value) => <StreakDots active={value} />,
  },
];

export function KpiRow() {
  const { t } = useApp();
  const { metrics } = useAppData();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {KPIS.map((k) => (
        <KpiCard
          key={k.key}
          label={t(k.key)}
          value={metrics[k.metric]}
          icon={k.icon}
          accent={k.accent}
          delta={k.delta}
          spark={k.spark?.(metrics[k.metric])}
        />
      ))}
    </div>
  );
}
