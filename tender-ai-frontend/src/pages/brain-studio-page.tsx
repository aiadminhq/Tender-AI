// /settings/brain：AI 大腦工作室。把原本擠在 /settings 的「大腦」卡升級成獨立寬版頁：
// 左欄＝引擎設定（直接複用 <BrainPicker />，含目前大腦摘要／provider 三選／CLI 代理／模型／測試），
// 右欄＝可用引擎總覽（把後端註冊表 agents 卡片化：label、可指定模型徽章、需本機驗證徽章、可選模型清單）。
// 零後端改動、零核心邏輯重寫；右欄為唯讀資訊，切換與調模型一律走左欄表單。
import { useApp } from "@/store/app-context";
import { PageHeader } from "@/components/layout/page-header";
import { BrainPicker } from "@/components/settings/brain-picker";
import { useBrainStore } from "@/hooks/use-brain-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TextKey } from "@/i18n/strings";

export function BrainStudioPage() {
  const { t } = useApp();
  const { agents, loaded, error } = useBrainStore();

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        title={t("brainStudioTitle")}
        subtitle={t("brainStudioSub")}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* 左欄：引擎設定（複用既有 BrainPicker 全部表單邏輯） */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t("brainStudioConfigTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <BrainPicker />
          </CardContent>
        </Card>

        {/* 右欄：可用引擎總覽（唯讀，自註冊表 agents 卡片化） */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t("brainStudioEnginesTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-[12px] text-ink-muted">
              {t("brainStudioEnginesSub")}
            </p>

            {error && (
              <p className="text-[12px] text-destructive">
                {t("brainLoadError")}
              </p>
            )}
            {!error && !loaded && (
              <p className="text-[12px] text-ink-muted">…</p>
            )}

            {!error && loaded && (
              <ul className="grid gap-3 sm:grid-cols-2">
                {agents.map((a) => (
                  <li
                    key={a.key}
                    className="rounded-2xl border border-line bg-surface-muted/40 px-3.5 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[14px] font-semibold text-ink">
                        {t(a.labelI18n as TextKey)}
                      </span>
                      {a.supportsModel && (
                        <Badge variant="signal">
                          {t("brainStudioSupportsModel")}
                        </Badge>
                      )}
                      {a.needsLocalVerify && (
                        <Badge
                          variant="muted"
                          title={t("brainNeedsLocalVerifyHint")}
                        >
                          {t("brainNeedsLocalVerify")}
                        </Badge>
                      )}
                    </div>

                    <div className="mt-2">
                      <span className="block text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                        {t("brainStudioModelsLabel")}
                      </span>
                      {a.models.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {a.models.map((m) => (
                            <span
                              key={m}
                              className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-muted"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="mt-1 block text-[11px] text-ink-dim">
                          {t("brainStudioModelsNone")}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
