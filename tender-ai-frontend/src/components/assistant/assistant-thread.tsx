// 小助手對話串（純呈現）：空狀態建議 + user/assistant 泡泡 + 來源清單。
// 浮窗 AssistantLauncher 與整頁 AssistantPage 共用；自動捲到底由內建 endRef 負責，
// 不依賴特定捲動祖層（scrollIntoView({block:"end"}) 對任一可捲祖層皆有效）。
import { useEffect, useRef } from "react";
import { Bot, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { useApp } from "@/store/app-context";
import type { TextKey } from "@/i18n/strings";
import type { AssistantSource } from "@/lib/assistant";
import { RichText } from "./rich-text";
import type { Turn } from "./use-assistant-chat";
import { cn } from "@/lib/utils";

// 來源類別 → i18n 字串鍵；知識庫類另渲染不同樣式（見 SourceChip）。
const KIND_KEY: Record<AssistantSource["kind"], TextKey> = {
  tender: "assistantKindTender",
  semantic: "assistantKindSemantic",
  similar: "assistantKindSimilar",
  knowledge: "assistantKindKnowledge",
};

export function AssistantThread({
  turns,
  suggestions,
  onSend,
  onSourceClick,
}: {
  turns: Turn[];
  suggestions: string[];
  onSend: (text: string) => void;
  onSourceClick: (s: AssistantSource) => void;
}) {
  const { t } = useApp();
  const endRef = useRef<HTMLDivElement | null>(null);

  // 新訊息 / 串流更新（turns 參照每次更新都會變）→ 捲到底。
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  if (turns.length === 0) {
    return (
      <div className="space-y-4 py-2">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          {t("assistantEmpty")}
        </p>
        <div className="flex flex-col gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onSend(s)}
              className="group flex items-center gap-2 rounded-lg border border-border bg-canvas px-3 py-2.5 text-left text-[13px] text-foreground/90 transition-colors hover:border-primary/50 hover:bg-accent"
            >
              <Sparkles
                size={13}
                className="shrink-0 text-ink-dim group-hover:text-primary"
              />
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {turns.map((turn, i) =>
        turn.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-[13px] leading-relaxed text-primary-foreground">
              {turn.text}
            </div>
          </div>
        ) : (
          <div key={i} className="flex gap-2.5">
            <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
              <Bot size={15} />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              {turn.text ? (
                <div
                  className={cn(
                    "rounded-2xl rounded-tl-sm bg-card px-3.5 py-2.5",
                    turn.error && "text-danger",
                  )}
                >
                  {turn.error ? (
                    <p className="text-[13px] leading-relaxed">{turn.text}</p>
                  ) : (
                    <RichText text={turn.text} />
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-card px-3.5 py-2.5 text-[12px] text-ink-muted">
                  <Loader2 size={13} className="animate-spin" />
                  {t("assistantThinking")}
                </div>
              )}
              {turn.sources && turn.sources.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-ink-dim">
                    {t("assistantSources")}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {turn.sources.map((s, j) => (
                      <SourceChip
                        key={`${s.tenderId ?? s.docId ?? "k"}-${s.kind}-${j}`}
                        source={s}
                        onClick={() => onSourceClick(s)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}

function SourceChip({
  source,
  onClick,
}: {
  source: AssistantSource;
  onClick: () => void;
}) {
  const { t } = useApp();
  const isKnowledge = source.kind === "knowledge";

  // 知識庫來源：primary 色 badge（與標案的中性 accent 區隔），標題下方顯示 heading
  // （文件區段），不顯示外連圖示。
  const badgeCls = isKnowledge
    ? "rounded bg-primary/12 px-1.5 py-0.5 text-[10px] font-medium text-primary"
    : "rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-ink-muted";

  const inner = (
    <>
      <span className={badgeCls}>{t(KIND_KEY[source.kind])}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12px] text-foreground/90">
          {source.title}
        </span>
        {isKnowledge && source.heading && (
          <span className="truncate text-[10px] text-ink-dim">
            {source.heading}
          </span>
        )}
      </span>
      <span className="shrink-0 text-[10px] text-ink-dim">{source.source}</span>
      {!isKnowledge && source.url && (
        <ExternalLink size={12} className="shrink-0 text-ink-dim" />
      )}
    </>
  );
  const cls =
    "flex items-center gap-2 rounded-md border border-border bg-canvas px-2.5 py-1.5 text-left transition-colors hover:border-primary/50 hover:bg-accent";
  // 知識庫來源無外連 URL → 一律渲染為 button（記 click_link 事件）。
  return !isKnowledge && source.url ? (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      onClick={onClick}
      className={cls}
    >
      {inner}
    </a>
  ) : (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}
