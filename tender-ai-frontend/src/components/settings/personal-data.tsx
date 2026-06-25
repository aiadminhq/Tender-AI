// 設定 · 個人資料與共享：本人 Layer B 共享同意開關（PUT /me/consent）
// ＋ AI 從本人行為學到的個人化偏好輪廓（GET /me/preference-profile，唯讀）。
//
// 治理（CLAUDE.md Layer B 紅線）：
//  - 共享同意決定本人的收藏／評分／想法是否「去識別化前以登入帳號具名」匯入白名單
//    團隊共享知識庫；關閉即停止匯入（對外永不揭露）。
//  - 偏好輪廓只用本人資料、依登入帳號具名，純展示後端衍生結果（不就地改權重）。
//  - 示範模式（無後端帳號）不顯示本卡。
import { useEffect, useState } from "react";
import { useApp } from "@/store/app-context";
import { useAuth } from "@/store/auth-context";
import { fetchPreferenceProfile, type PreferenceProfile } from "@/lib/api";
import { formatBudget, formatDateLong } from "@/lib/format";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

type SaveState = "idle" | "saving" | "savedOn" | "savedOff" | "failed";

export function PersonalData() {
  const { t, lang } = useApp();
  const { user, isMock, updateConsent } = useAuth();
  const [save, setSave] = useState<SaveState>("idle");
  const [profile, setProfile] = useState<PreferenceProfile | null>(null);

  // 偏好輪廓：登入身分變動時抓一次（user_id 由 auth-context 注入 api.ts）。
  const userId = user?.id;
  useEffect(() => {
    if (!userId || isMock) {
      setProfile(null);
      return;
    }
    const controller = new AbortController();
    fetchPreferenceProfile(controller.signal)
      .then((p) => {
        if (!controller.signal.aborted) setProfile(p);
      })
      .catch(() => {
        if (!controller.signal.aborted) setProfile(null);
      });
    return () => controller.abort();
    // user_id 由 auth-context 注入 api.ts；這裡僅依 userId 變動重抓
  }, [userId, isMock]);

  if (!user || isMock) return null;

  async function onToggle(next: boolean) {
    if (save === "saving") return;
    setSave("saving");
    const ok = await updateConsent(next);
    setSave(ok ? (next ? "savedOn" : "savedOff") : "failed");
  }

  const tags = (label: string, items: string[]) =>
    items.length > 0 ? (
      <div>
        <div className="mb-1.5 text-[11px] text-ink-dim">{label}</div>
        <div className="flex flex-wrap gap-1.5">
          {items.map((it) => (
            <Badge key={it} variant="muted">
              {it}
            </Badge>
          ))}
        </div>
      </div>
    ) : null;

  const budget =
    profile && (profile.budgetMin != null || profile.budgetMax != null)
      ? `${profile.budgetMin != null ? formatBudget(profile.budgetMin, lang) : "—"} – ${
          profile.budgetMax != null
            ? formatBudget(profile.budgetMax, lang)
            : "—"
        }`
      : null;

  const hasProfile =
    profile != null &&
    (profile.topKeywords.length > 0 ||
      profile.avoidKeywords.length > 0 ||
      profile.preferredCategories.length > 0 ||
      budget != null);

  return (
    <div className="space-y-5">
      {/* 共享同意開關 */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">
            {t("consentToggleLabel")}
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
            {t("consentToggleDesc")}
          </p>
          <p className="mt-1 text-[12px] font-medium text-ink-muted">
            {user.consentShared ? t("consentOptOutOn") : t("consentOptOutOff")}
          </p>
          {user.consentShared && user.consentAt && (
            <p className="mt-1 text-[11px] text-ink-dim">
              {t("consentSince")} {formatDateLong(user.consentAt, lang)}
            </p>
          )}
        </div>
        <Switch
          checked={user.consentShared}
          onCheckedChange={onToggle}
          disabled={save === "saving"}
          label={t("consentToggleLabel")}
          className="mt-0.5"
        />
      </div>
      {save === "savedOn" && (
        <p className="text-[12px] font-medium text-success">
          {t("consentSavedOn")}
        </p>
      )}
      {save === "savedOff" && (
        <p className="text-[12px] font-medium text-ink-muted">
          {t("consentSavedOff")}
        </p>
      )}
      {save === "failed" && (
        <p role="alert" className="text-[12px] font-medium text-destructive">
          {t("consentSaveFailed")}
        </p>
      )}

      {/* AI 學到的偏好輪廓（唯讀） */}
      <div className="border-t border-hairline pt-4">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-dim">
          {t("prefProfileTitle")}
        </div>
        {hasProfile && profile ? (
          <div className="space-y-3">
            {tags(t("prefTopKeywords"), profile.topKeywords)}
            {tags(t("prefAvoidKeywords"), profile.avoidKeywords)}
            {tags(t("prefCategories"), profile.preferredCategories)}
            {budget && (
              <div>
                <div className="mb-1 text-[11px] text-ink-dim">
                  {t("prefBudgetRange")}
                </div>
                <div className="tnum text-[13px] text-ink">{budget}</div>
              </div>
            )}
            {profile.updatedAt && (
              <p className="text-[11px] text-ink-dim">
                {t("prefUpdatedAt")} {formatDateLong(profile.updatedAt, lang)}
              </p>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-ink-dim">{t("prefProfileEmpty")}</p>
        )}
      </div>
    </div>
  );
}
