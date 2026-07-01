// 設定 · 小助手大腦：選擇 AI 助手視窗背後由哪個 provider 生成（GET/PUT /settings/brain）。
// ollama（本機換模型）／cli（spawn 本機 headless CLI 自主 agentic）／byok（自帶金鑰雲端）。
// CLI 代理與可選模型由後端註冊表（GET /settings/brain/agents）動態驅動，含 per-agent 模型
// 與「需本機驗證」徽章；可在儲存前用「測試」鈕對候選設定做煙測。
// secret 紅線（見 CLAUDE.md）：BYOK 金鑰本體只進後端 .env；此表單只讀寫非密欄位，
// byokKeySet 為唯讀狀態（金鑰是否已設定），永不顯示/輸入金鑰本體。
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useApp } from "@/store/app-context";
import {
  updateBrainConfig,
  testBrainConfig,
  type BrainConfig,
  type BrainProvider,
  type BrainAgentSpec,
  type BrainTestResult,
} from "@/lib/brain";
import { useBrainStore, applyBrainUpdate } from "@/hooks/use-brain-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { TextKey } from "@/i18n/strings";

export function BrainPicker() {
  const { t } = useApp();
  const { config: storeConfig, agents, loaded, error } = useBrainStore();

  // 受控編輯狀態：自共享 store 初始化一次，儲存時才送 PUT。
  const [config, setConfig] = useState<BrainConfig | null>(null);
  const [saveErr, setSaveErr] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<BrainTestResult | null>(null);

  // store 首次載入完成後，把目前設定灌進本地編輯狀態。
  useEffect(() => {
    if (storeConfig && config === null) setConfig(storeConfig);
  }, [storeConfig, config]);

  // key → 代理規格，供 label／模型／徽章查詢。
  const agentByKey = useMemo(() => {
    const m = new Map<string, BrainAgentSpec>();
    for (const a of agents) m.set(a.key, a);
    return m;
  }, [agents]);

  function agentLabel(key: string | null): string {
    if (!key) return "";
    const spec = agentByKey.get(key);
    return spec ? t(spec.labelI18n as TextKey) : key;
  }

  // 把一份設定描述成人話：cli → 「本機 CLI · Claude Code · 模型」等。
  function describeBrain(c: BrainConfig): string {
    if (c.provider === "cli") {
      const agent = c.cliAgent ?? "claude";
      const base = `${t("brainProviderCli")} · ${agentLabel(agent)}`;
      return c.cliModel?.trim() ? `${base} · ${c.cliModel.trim()}` : base;
    }
    if (c.provider === "byok") {
      const model = c.byokModel?.trim();
      return model
        ? `${t("brainProviderByok")} · ${model}`
        : t("brainProviderByok");
    }
    const model = c.ollamaModel?.trim();
    return model
      ? `${t("brainProviderOllama")} · ${model}`
      : t("brainProviderOllama");
  }

  if (error) {
    return (
      <p className="text-[12px] text-destructive">{t("brainLoadError")}</p>
    );
  }
  if (!loaded || !config) {
    return <p className="text-[12px] text-ink-muted">…</p>;
  }

  // 受控編輯：就地改 config，儲存時才送 PUT。
  function patch(changes: Partial<BrainConfig>) {
    setConfig((prev) => (prev ? { ...prev, ...changes } : prev));
    setSaved(false);
    setSaveErr(false);
    setTestResult(null);
  }

  // 切換 CLI 代理時順手清掉與前一代理綁定的模型（避免把 codex 模型帶到 claude）。
  function onPickAgent(key: string) {
    patch({ cliAgent: key, cliModel: null });
  }

  const selectedAgent =
    config.provider === "cli"
      ? (agentByKey.get(config.cliAgent ?? "claude") ?? null)
      : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !config) return;
    setBusy(true);
    setSaveErr(false);
    setSaved(false);
    try {
      const next = await updateBrainConfig({
        provider: config.provider,
        ollamaModel: config.ollamaModel || null,
        cliAgent: config.cliAgent || null,
        cliModel: config.cliModel || null,
        byokProtocol: "anthropic",
        byokBaseUrl: config.byokBaseUrl || null,
        byokModel: config.byokModel || null,
      });
      setConfig(next);
      applyBrainUpdate(next); // 全域同步「目前大腦」（含對話內 picker）
      setSaved(true);
    } catch {
      setSaveErr(true);
    } finally {
      setBusy(false);
    }
  }

  // 以「目前編輯中的候選設定」做煙測（不落地）。
  async function onTest() {
    if (testing || !config) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testBrainConfig({
        provider: config.provider,
        ollamaModel: config.ollamaModel || null,
        cliAgent: config.cliAgent || null,
        cliModel: config.cliModel || null,
        byokProtocol: "anthropic",
        byokBaseUrl: config.byokBaseUrl || null,
        byokModel: config.byokModel || null,
      });
      setTestResult(result);
    } catch {
      setTestResult({
        ok: false,
        provider: config.provider,
        model: null,
        elapsedMs: 0,
        sample: "",
        error: t("brainSaveError"),
      });
    } finally {
      setTesting(false);
    }
  }

  const providerOptions: { value: BrainProvider; label: string }[] = [
    { value: "ollama", label: t("brainProviderOllama") },
    { value: "cli", label: t("brainProviderCli") },
    { value: "byok", label: t("brainProviderByok") },
  ];

  // CLI 模型選單：代理有列模型 → 下拉（代理預設 + 候選）；否則無下拉，僅自由輸入。
  const cliModelOptions =
    selectedAgent && selectedAgent.models.length > 0
      ? [
          { value: "", label: t("brainCliModelDefault") },
          ...selectedAgent.models.map((m) => ({ value: m, label: m })),
        ]
      : null;

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      {storeConfig && (
        <div className="rounded-2xl border border-line bg-surface-muted/40 px-3.5 py-3">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            {t("brainCurrent")}
          </span>
          <span className="mt-0.5 block text-[14px] font-semibold text-ink">
            {describeBrain(storeConfig)}
          </span>
          <span className="mt-1 block text-[11px] text-ink-muted">
            {t("brainCurrentHint")}
          </span>
        </div>
      )}

      <label className="block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
          {t("brainProvider")}
        </span>
        <Select
          value={config.provider}
          onValueChange={(v) => patch({ provider: v as BrainProvider })}
          options={providerOptions}
          disabled={busy}
        />
        <span className="mt-1.5 block text-[11px] text-ink-muted">
          {t("brainProviderHint")}
        </span>
      </label>

      {config.provider === "ollama" && (
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
            {t("brainOllamaModel")}
          </span>
          <Input
            value={config.ollamaModel ?? ""}
            placeholder={t("brainOllamaModelPh")}
            onChange={(e) => patch({ ollamaModel: e.target.value })}
            disabled={busy}
          />
        </label>
      )}

      {config.provider === "cli" && (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-ink-muted">
              {t("brainCliAgent")}
              {selectedAgent?.needsLocalVerify && (
                <Badge variant="muted" title={t("brainNeedsLocalVerifyHint")}>
                  {t("brainNeedsLocalVerify")}
                </Badge>
              )}
            </span>
            <Select
              value={config.cliAgent ?? "claude"}
              onValueChange={onPickAgent}
              options={agents.map((a) => ({
                value: a.key,
                label: t(a.labelI18n as TextKey),
              }))}
              disabled={busy}
            />
            <span className="mt-1.5 block text-[11px] text-ink-muted">
              {t("brainCliAgentHint")}
            </span>
          </label>

          {selectedAgent && (
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
                {t("brainCliModel")}
              </span>
              {!selectedAgent.supportsModel ? (
                <p className="text-[11px] text-ink-muted">
                  {t("brainCliModelUnsupported")}
                </p>
              ) : cliModelOptions ? (
                <Select
                  value={config.cliModel ?? ""}
                  onValueChange={(v) => patch({ cliModel: v || null })}
                  options={cliModelOptions}
                  disabled={busy}
                />
              ) : (
                <Input
                  value={config.cliModel ?? ""}
                  placeholder={t("brainCliModelPh")}
                  onChange={(e) => patch({ cliModel: e.target.value })}
                  disabled={busy}
                />
              )}
              {selectedAgent.supportsModel && (
                <span className="mt-1.5 block text-[11px] text-ink-muted">
                  {t("brainCliModelHint")}
                </span>
              )}
            </label>
          )}
        </div>
      )}

      {config.provider === "byok" && (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
              {t("brainByokModel")}
            </span>
            <Input
              value={config.byokModel ?? ""}
              placeholder={t("brainByokModelPh")}
              onChange={(e) => patch({ byokModel: e.target.value })}
              disabled={busy}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
              {t("brainByokBaseUrl")}
            </span>
            <Input
              value={config.byokBaseUrl ?? ""}
              placeholder={t("brainByokBaseUrlPh")}
              onChange={(e) => patch({ byokBaseUrl: e.target.value })}
              disabled={busy}
            />
          </label>
          <p
            className={
              config.byokKeySet
                ? "text-[12px] font-medium text-success"
                : "text-[12px] font-medium text-tier-mid"
            }
          >
            {config.byokKeySet
              ? t("brainByokKeySet")
              : t("brainByokKeyMissing")}
          </p>
        </div>
      )}

      {/* 測試結果 chip：testing / ok（+樣本） / fail（+錯誤） */}
      {testResult && (
        <div
          className={
            testResult.ok
              ? "rounded-xl border border-success/30 bg-success/8 px-3 py-2"
              : "rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2"
          }
        >
          <div className="flex items-center gap-2">
            <Badge variant={testResult.ok ? "success" : "danger"}>
              {testResult.ok ? t("brainTestOk") : t("brainTestFail")}
            </Badge>
            {testResult.model && (
              <span className="text-[11px] text-ink-muted">
                {testResult.model}
              </span>
            )}
            <span className="text-[11px] text-ink-muted">
              {testResult.elapsedMs}ms
            </span>
          </div>
          {testResult.ok && testResult.sample && (
            <p className="mt-1 line-clamp-2 text-[11px] text-ink">
              {testResult.sample}
            </p>
          )}
          {!testResult.ok && testResult.error && (
            <p className="mt-1 text-[11px] text-destructive">
              {testResult.error}
            </p>
          )}
        </div>
      )}

      {saveErr && (
        <p role="alert" className="text-[12px] font-medium text-destructive">
          {t("brainSaveError")}
        </p>
      )}
      {saved && (
        <p className="text-[12px] font-medium text-success">
          {t("brainSaved")}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? t("brainSaving") : t("brainSave")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || testing}
          onClick={onTest}
          title={t("brainTestHint")}
        >
          {testing ? t("brainTesting") : t("brainTest")}
        </Button>
      </div>
    </form>
  );
}
