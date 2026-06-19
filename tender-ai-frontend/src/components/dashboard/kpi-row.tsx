import {
  Activity,
  CircleCheck,
  Clock,
  Flame,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData, type Metrics } from "@/store/app-data";
import type { TextKey } from "@/i18n/strings";
import { KpiCard, type KpiAccent } from "./kpi-card";

interface KpiDef {
  key: TextKey;
  metric: keyof Metrics;
  icon: LucideIcon;
  accent: KpiAccent;
}

const KPIS: KpiDef[] = [
  { key: "kpiNew", metric: "kpiNew", icon: Inbox, accent: "signal" },
  { key: "kpiHigh", metric: "kpiHigh", icon: Flame, accent: "high" },
  { key: "kpiClosing", metric: "kpiClosing", icon: Clock, accent: "low" },
  {
    key: "kpiInProgress",
    metric: "kpiInProgress",
    icon: Activity,
    accent: "priority",
  },
  {
    key: "kpiAccepted",
    metric: "kpiAccepted",
    icon: CircleCheck,
    accent: "high",
  },
];

export function KpiRow() {
  const { t } = useApp();
  const { metrics } = useAppData();
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:gap-5 lg:grid-cols-5">
      {KPIS.map((k) => (
        <KpiCard
          key={k.key}
          label={t(k.key)}
          value={metrics[k.metric]}
          icon={k.icon}
          accent={k.accent}
        />
      ))}
    </div>
  );
}
