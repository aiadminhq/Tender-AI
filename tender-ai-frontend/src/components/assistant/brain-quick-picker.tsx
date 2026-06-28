// 對話內「大腦」快速切換：composer 左下角的精簡膠囊＋原生 select。
// 與設定頁 BrainPicker 共用同一份 useBrainStore：任一處切換即時同步「目前大腦」。
// 切換只改「引擎／CLI 代理」（provider 或 cli_agent），不動模型等細項——細項仍在設定頁調。
// 切換後立即 PUT 落地並 applyBrainUpdate 全域同步；失敗則回滾 UI（不阻斷對話）。
import { useMemo, useState } from "react";
import { useApp } from "@/store/app-context";
import {
  updateBrainConfig,
  type BrainConfig,
  type BrainProvider,
} from "@/lib/brain";
import { useBrainStore, applyBrainUpdate } from "@/hooks/use-brain-config";
import type { TextKey } from "@/i18n/strings";
import { cn } from "@/lib/utils";

// select option value 編碼：ollama / byok 直接用 provider；CLI 代理用 "cli:<key>"。
function encode(config: BrainConfig): string {
  if (config.provider === "cli") return `cli:${config.cliAgent ?? "claude"}`;
  return config.provider;
}

export function BrainQuickPicker({ className }: { className?: string }) {
  const { t } = useApp();
  const { config, agents, loaded, error } = useBrainStore();
  const [busy, setBusy] = useState(false);

  // 扁平選單：Ollama／各 CLI 代理／BYOK，一列切換引擎。
  const options = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: "ollama", label: t("brainProviderOllama") },
      ...agents.map((a) => ({
        value: `cli:${a.key}`,
        label: t(a.labelI18n as TextKey),
      })),
      { value: "byok", label: t("brainProviderByok") },
    ];
    return opts;
  }, [agents, t]);

  if (error || !loaded || !config) return null;

  const value = encode(config);

  async function onChange(next: string) {
    if (busy || !config || next === value) return;
    // 解碼成 provider／cliAgent 變更。
    let changes: Partial<BrainConfig>;
    if (next.startsWith("cli:")) {
      changes = { provider: "cli", cliAgent: next.slice(4) };
    } else {
      changes = { provider: next as BrainProvider };
    }
    const optimistic = { ...config, ...changes };
    applyBrainUpdate(optimistic); // 先樂觀更新，切換手感即時
    setBusy(true);
    try {
      const saved = await updateBrainConfig({
        provider: optimistic.provider,
        cliAgent: optimistic.cliAgent,
      });
      applyBrainUpdate(saved);
    } catch {
      applyBrainUpdate(config); // 失敗回滾
    } finally {
      setBusy(false);
    }
  }

  return (
    <label
      title={t("brainQuickHint")}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-white/70 px-2 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:border-orange-200",
        busy && "opacity-60",
        className,
      )}
    >
      <span className="text-ink-dim">{t("brainQuickLabel")}</span>
      <select
        value={value}
        disabled={busy}
        onChange={(e) => void onChange(e.target.value)}
        className="cursor-pointer bg-transparent pr-0.5 text-[11px] font-semibold text-ink outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
