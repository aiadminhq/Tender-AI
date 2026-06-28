// 設定 · 小助手大腦：選擇 AI 助手視窗背後由哪個 provider 生成（GET/PUT /settings/brain）。
// ollama（本機換模型）／cli（spawn 本機 headless CLI 自主 agentic）／byok（自帶金鑰雲端）。
// secret 紅線（見 CLAUDE.md）：BYOK 金鑰本體只進後端 .env；此表單只讀寫非密欄位，
// byokKeySet 為唯讀狀態（金鑰是否已設定），永不顯示/輸入金鑰本體。
import { useEffect, useState, type FormEvent } from "react";
import { useApp } from "@/store/app-context";
import {
  fetchBrainConfig,
  updateBrainConfig,
  type BrainConfig,
  type BrainProvider,
  type CliAgent,
} from "@/lib/brain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const CLI_AGENTS: CliAgent[] = ["claude", "codex", "hermes"];

// CLI 代理顯示名稱（i18n key），避免畫面直接吐 raw slug（claude → Claude Code）。
const CLI_AGENT_LABEL = {
  claude: "brainCliClaude",
  codex: "brainCliCodex",
  hermes: "brainCliHermes",
} as const satisfies Record<CliAgent, string>;

export function BrainPicker() {
  const { t } = useApp();
  const [config, setConfig] = useState<BrainConfig | null>(null);
  // 目前實際指派（最後一次成功讀取／儲存）的大腦——與編輯中的 config 分開，
  // 讓「目前大腦」readout 不會隨未儲存的編輯跳動。
  const [current, setCurrent] = useState<BrainConfig | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchBrainConfig(ctrl.signal)
      .then((c) => {
        setConfig(c);
        setCurrent(c);
      })
      .catch(() => setLoadErr(true));
    return () => ctrl.abort();
  }, []);

  // 把一份設定描述成人話：cli → 「本機 CLI · Claude Code」等。
  function describeBrain(c: BrainConfig): string {
    if (c.provider === "cli") {
      const agent = (c.cliAgent as CliAgent | null) ?? "claude";
      return `${t("brainProviderCli")} · ${t(CLI_AGENT_LABEL[agent])}`;
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

  if (loadErr) {
    return (
      <p className="text-[12px] text-destructive">{t("brainLoadError")}</p>
    );
  }
  if (!config) {
    return <p className="text-[12px] text-ink-muted">…</p>;
  }

  // 受控編輯：就地改 config，儲存時才送 PUT。
  function patch(changes: Partial<BrainConfig>) {
    setConfig((prev) => (prev ? { ...prev, ...changes } : prev));
    setSaved(false);
    setSaveErr(false);
  }

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
        cliAgent: (config.cliAgent as CliAgent | null) || null,
        byokProtocol: "anthropic",
        byokBaseUrl: config.byokBaseUrl || null,
        byokModel: config.byokModel || null,
      });
      setConfig(next);
      setCurrent(next);
      setSaved(true);
    } catch {
      setSaveErr(true);
    } finally {
      setBusy(false);
    }
  }

  const providerOptions: { value: BrainProvider; label: string }[] = [
    { value: "ollama", label: t("brainProviderOllama") },
    { value: "cli", label: t("brainProviderCli") },
    { value: "byok", label: t("brainProviderByok") },
  ];

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      {current && (
        <div className="rounded-2xl border border-line bg-surface-muted/40 px-3.5 py-3">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            {t("brainCurrent")}
          </span>
          <span className="mt-0.5 block text-[14px] font-semibold text-ink">
            {describeBrain(current)}
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
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-ink-muted">
            {t("brainCliAgent")}
          </span>
          <Select
            value={config.cliAgent ?? "claude"}
            onValueChange={(v) => patch({ cliAgent: v })}
            options={CLI_AGENTS.map((a) => ({
              value: a,
              label: t(CLI_AGENT_LABEL[a]),
            }))}
            disabled={busy}
          />
          <span className="mt-1.5 block text-[11px] text-ink-muted">
            {t("brainCliAgentHint")}
          </span>
        </label>
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

      <Button type="submit" variant="primary" size="sm" disabled={busy}>
        {busy ? t("brainSaving") : t("brainSave")}
      </Button>
    </form>
  );
}
