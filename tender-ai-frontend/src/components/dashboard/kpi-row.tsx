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

interface KpiScopeContext {
  activeTenders: number;
  tendersWithDeadline: number;
  activeCards: number;
  allCards: number;
}

interface KpiDef {
  key: TextKey;
  hintKey: TextKey;
  metric: keyof Metrics;
  icon: LucideIcon;
  accent: KpiAccent;
  scope: (context: KpiScopeContext) => number;
}

// 不以靜態 sparkline 偽裝成趨勢。每張卡的 coverage 皆由目前資料範圍即時計算。
const KPIS: KpiDef[] = [
  {
    key: "kpiNew",
    hintKey: "kpiNewHint",
    metric: "kpiNew",
    icon: Inbox,
    accent: "signal",
    scope: ({ activeTenders }) => activeTenders,
  },
  {
    key: "kpiHigh",
    hintKey: "kpiHighHint",
    metric: "kpiHigh",
    icon: Flame,
    accent: "high",
    scope: ({ activeTenders }) => activeTenders,
  },
  {
    key: "kpiClosing",
    hintKey: "kpiClosingHint",
    metric: "kpiClosing",
    icon: Clock,
    accent: "low",
    scope: ({ tendersWithDeadline }) => tendersWithDeadline,
  },
  {
    key: "kpiInProgress",
    hintKey: "kpiInProgressHint",
    metric: "kpiInProgress",
    icon: Activity,
    accent: "priority",
    scope: ({ activeCards }) => activeCards,
  },
  {
    key: "kpiAccepted",
    hintKey: "kpiAcceptedHint",
    metric: "kpiAccepted",
    icon: CircleCheck,
    accent: "high",
    scope: ({ allCards }) => allCards,
  },
];

export function KpiRow() {
  const { t } = useApp();
  const { metrics, tenders, cards, isExcluded } = useAppData();
  const activeTenders = tenders.filter((tender) => !isExcluded(tender));
  const scope: KpiScopeContext = {
    activeTenders: activeTenders.length,
    tendersWithDeadline: activeTenders.filter((tender) => tender.deadline)
      .length,
    activeCards: cards.filter((card) => card.status !== "done").length,
    allCards: cards.length,
  };

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {KPIS.map((k) => (
        <KpiCard
          key={k.key}
          label={t(k.key)}
          value={metrics[k.metric]}
          icon={k.icon}
          accent={k.accent}
          hint={t(k.hintKey)}
          scopeTotal={k.scope(scope)}
          scopeLabel={t("kpiScope")}
        />
      ))}
    </div>
  );
}
