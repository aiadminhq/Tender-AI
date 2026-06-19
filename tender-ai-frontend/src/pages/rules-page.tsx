import { useApp } from "@/store/app-context";
import { PageHeader } from "@/components/layout/page-header";
import { RulesPanel } from "@/components/rules/rules-panel";

export function RulesPage() {
  const { t } = useApp();

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title={t("navRules")} subtitle={t("rulesSub")} />
      <RulesPanel />
    </div>
  );
}
