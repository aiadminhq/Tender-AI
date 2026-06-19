import { useApp } from "@/store/app-context";
import { PageHeader } from "@/components/layout/page-header";
import { SourceStatusList } from "@/components/layout/source-status";
import { RulesWorkspace } from "@/components/rules/rules-workspace";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// /settings：系統設定載體。本波含「來源管理」「關鍵字管理（內嵌規則進階工作區）」兩張卡片。
export function SettingsPage() {
  const { t } = useApp();

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title={t("settings")} subtitle={t("rulesSub")} />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{t("sourcesManage")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SourceStatusList />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("focusKeywords")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-[12px] text-ink-muted">{t("rulesHint")}</p>
          <RulesWorkspace />
        </CardContent>
      </Card>
    </div>
  );
}
