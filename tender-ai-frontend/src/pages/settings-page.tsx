import { useApp } from "@/store/app-context";
import { useAuth } from "@/store/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { SourceStatusList } from "@/components/layout/source-status";
import { RulesWorkspace } from "@/components/rules/rules-workspace";
import { AccountSecurity } from "@/components/settings/account-security";
import { PersonalData } from "@/components/settings/personal-data";
import { AdminUserPasswords } from "@/components/settings/admin-user-passwords";
import { MemberManagement } from "@/components/settings/member-management";
import { BrainPicker } from "@/components/settings/brain-picker";
import { DetailFieldSettings } from "@/components/settings/detail-field-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// /settings：系統設定載體。本波含「來源管理」「關鍵字管理」「帳號安全（改密）」，
// 管理員另見「成員密碼管理」；仍用預設密碼時於頁首提示建議修改。
export function SettingsPage() {
  const { t, lang } = useApp();
  const { user, isAdmin, isMock } = useAuth();
  const showPwDefault = !isMock && !!user?.passwordIsDefault;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title={t("settings")} subtitle={t("rulesSub")} />

      {showPwDefault && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-tier-mid/40 bg-tier-mid/10 px-4 py-3">
          <p className="text-[13px] text-ink">{t("pwDefaultBanner")}</p>
          <a
            href="#account-security"
            className="shrink-0 text-[12px] font-semibold text-tier-mid hover:underline"
          >
            {t("pwDefaultBannerCta")}
          </a>
        </div>
      )}

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

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{t("brainTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-[12px] text-ink-muted">{t("brainSub")}</p>
          <BrainPicker />
        </CardContent>
      </Card>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>
            {lang === "en" ? "Tender detail fields" : "標案詳情欄位"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DetailFieldSettings />
        </CardContent>
      </Card>

      {!isMock && user && (
        <Card id="account-security" className="max-w-xl scroll-mt-6">
          <CardHeader>
            <CardTitle>{t("accountSecurity")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-[12px] text-ink-muted">
              {t("accountSecuritySub")}
            </p>
            <AccountSecurity />
          </CardContent>
        </Card>
      )}

      {!isMock && user && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>{t("personalData")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-[12px] text-ink-muted">
              {t("personalDataSub")}
            </p>
            <PersonalData />
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>{t("adminPasswords")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-[12px] text-ink-muted">
              {t("adminPasswordsSub")}
            </p>
            <AdminUserPasswords />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("memberManage")}</CardTitle>
        </CardHeader>
        <CardContent>
          <MemberManagement />
        </CardContent>
      </Card>
    </div>
  );
}
