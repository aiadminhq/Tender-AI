// 房屋風格化的 assistant-ui Thread：以官方 primitives（ThreadPrimitive / ComposerPrimitive /
// AuiIf / useAuiState）搭出骨架，但渲染層改用本專案的 RichText、四類來源 SourceChip、
// Button 與設計語彙——不採官方 MarkdownText/TooltipIconButton，亦捨棄附件／推理／工具群組／
// 分支切換／聽寫等本專案用不到的零件。浮窗 Modal 與整頁指揮中心共用此元件。
import {
  Bot,
  Check,
  ExternalLink,
  Loader2,
  SendHorizontal,
  Sparkles,
  Square,
} from "lucide-react";
import {
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type AssistantState,
} from "@assistant-ui/react";
import { useApp } from "@/store/app-context";
import type { TextKey } from "@/i18n/strings";
import type { AssistantSource, PreferenceSuggestion } from "@/lib/assistant";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RichText } from "./rich-text";
import {
  useAssistantBridge,
  type AssistantCustomMeta,
} from "./assistant-runtime-provider";

// 來源類別 → i18n 字串鍵；知識庫類另渲染不同樣式（見 SourceChip）。
const KIND_KEY: Record<AssistantSource["kind"], TextKey> = {
  tender: "assistantKindTender",
  semantic: "assistantKindSemantic",
  similar: "assistantKindSimilar",
  knowledge: "assistantKindKnowledge",
};

const isNewChatView = (s: AssistantState) => s.thread.messages.length === 0;

/** 整個對話串（含空態建議、訊息列、底部 composer）。寬度由外層容器決定。 */
export function AssistantUIThread() {
  const { t } = useApp();

  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col bg-transparent">
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
      >
        <AuiIf condition={isNewChatView}>
          <ThreadEmpty />
        </AuiIf>
        <ThreadPrimitive.Messages
          components={{ UserMessage, AssistantMessage }}
        />
      </ThreadPrimitive.Viewport>

      <ThreadPrimitive.ViewportFooter className="border-t border-border px-4 py-3">
        <Composer placeholder={t("assistantPlaceholder")} />
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Root>
  );
}

/** 空態：提示語 + 四個建議題（點擊即送出）。 */
function ThreadEmpty() {
  const { t } = useApp();
  const { suggestions } = useAssistantBridge();
  return (
    <div className="space-y-4 py-2">
      <p className="text-[13px] leading-relaxed text-ink-muted">
        {t("assistantEmpty")}
      </p>
      <div className="flex flex-col gap-2">
        {suggestions.map((s) => (
          <ThreadPrimitive.Suggestion
            key={s}
            prompt={s}
            send
            clearComposer
            className="group flex items-center gap-2 rounded-lg border border-border bg-canvas px-3 py-2.5 text-left text-[13px] text-foreground/90 transition-colors hover:border-primary/50 hover:bg-accent"
          >
            <Sparkles
              size={13}
              className="shrink-0 text-ink-dim group-hover:text-primary"
            />
            {s}
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  );
}

/** 把訊息的 content parts 併成純文字（外部 store 以字串內容轉成單一 text part）。 */
function useMessageText(): string {
  return useAuiState((s: AssistantState) =>
    s.message.content.map((p) => (p.type === "text" ? p.text : "")).join(""),
  );
}

function useMessageMeta(): AssistantCustomMeta {
  const custom = useAuiState(
    (s: AssistantState) =>
      s.message.metadata?.custom as unknown as AssistantCustomMeta | undefined,
  );
  return (
    custom ?? {
      sources: null,
      error: false,
      preference: null,
      preferenceState: null,
    }
  );
}

function UserMessage() {
  const text = useMessageText();
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-[13px] leading-relaxed text-primary-foreground">
        {text}
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  const { t } = useApp();
  const { onSourceClick } = useAssistantBridge();
  const text = useMessageText();
  const { sources, error, preference, preferenceState } = useMessageMeta();

  return (
    <MessagePrimitive.Root className="flex gap-2.5">
      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
        <Bot size={15} />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {text ? (
          <div
            className={cn(
              "rounded-2xl rounded-tl-sm bg-card px-3.5 py-2.5",
              error && "text-danger",
            )}
          >
            {error ? (
              <p className="text-[13px] leading-relaxed">{text}</p>
            ) : (
              <RichText text={text} />
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-card px-3.5 py-2.5 text-[12px] text-ink-muted">
            <Loader2 size={13} className="animate-spin" />
            {t("assistantThinking")}
          </div>
        )}
        {sources && sources.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink-dim">
              {t("assistantSources")}
            </div>
            <div className="flex flex-col gap-1.5">
              {sources.map((s, j) => (
                <SourceChip
                  key={`${s.tenderId ?? s.docId ?? "k"}-${s.kind}-${j}`}
                  source={s}
                  onClick={() => onSourceClick(s)}
                />
              ))}
            </div>
          </div>
        )}
        {preference && preferenceState && preferenceState !== "dismissed" && (
          <PreferenceChip preference={preference} state={preferenceState} />
        )}
      </div>
    </MessagePrimitive.Root>
  );
}

/**
 * 偏好確認 chip（confirm-to-remember）：偵測到對話中的長期條件時詢問使用者，
 * 按「好,記住」才 POST 一筆具名 state_preference 事件（共享軟訊號,逐步調整,不立即硬擋）；
 * 按「不用」則收起（dismissed 不渲染）。已確認顯示「已記住」靜態提示。
 */
function PreferenceChip({
  preference,
  state,
}: {
  preference: PreferenceSuggestion;
  state: "pending" | "confirmed" | "dismissed";
}) {
  const { t } = useApp();
  const { resolvePreference } = useAssistantBridge();

  if (state === "confirmed") {
    return (
      <div className="flex items-center gap-1.5 rounded-2xl border border-primary/30 bg-primary/8 px-3 py-2 text-[12px] text-primary">
        <Check size={13} className="shrink-0" />
        {t("assistantPrefSaved")}
      </div>
    );
  }

  const question = (
    preference.op === "only"
      ? t("assistantPrefAskOnly")
      : t("assistantPrefAskExclude")
  ).replace("{region}", preference.value);

  return (
    <div className="space-y-2 rounded-2xl border border-primary/30 bg-primary/8 px-3.5 py-3">
      <p className="text-[13px] leading-relaxed text-foreground/90">
        {question}
      </p>
      <p className="text-[11px] leading-relaxed text-ink-dim">
        {t("assistantPrefHint")}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={() => resolvePreference(preference, "confirm")}
        >
          {t("assistantPrefConfirm")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => resolvePreference(preference, "dismiss")}
        >
          {t("assistantPrefDismiss")}
        </Button>
      </div>
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

  // 知識庫來源：primary 色 badge（與標案的中性 accent 區隔），標題下方顯示 heading。
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

/** 底部輸入區：textarea（Enter 送出、Shift+Enter 換行）＋ 送出／停止鈕（依串流狀態切換）。 */
function Composer({ placeholder }: { placeholder: string }) {
  const { t } = useApp();
  return (
    <ComposerPrimitive.Root className="flex items-end gap-2">
      <ComposerPrimitive.Input
        autoFocus
        rows={1}
        submitOnEnter
        placeholder={placeholder}
        aria-label={placeholder}
        className="max-h-32 min-h-[40px] flex-1 resize-none rounded-md border border-border bg-canvas px-3 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-dim focus:border-primary/50"
      />
      <AuiIf condition={(s: AssistantState) => !s.thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <Button size="icon" variant="primary" title={t("assistantSend")}>
            <SendHorizontal size={16} />
          </Button>
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s: AssistantState) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <Button size="icon" variant="outline" title={t("assistantThinking")}>
            <Square size={15} />
          </Button>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </ComposerPrimitive.Root>
  );
}
