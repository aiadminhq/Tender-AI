// 小助手輸入列（純呈現）：自適應 textarea + 送出鈕 +（可選）清除鈕。
// Enter 送出、Shift+Enter 換行於內部處理；浮窗與整頁共用。
import { type KeyboardEvent, type RefObject } from "react";
import { Loader2, SendHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/store/app-context";

export function AssistantComposer({
  draft,
  setDraft,
  onSend,
  streaming,
  showClear,
  onClear,
  inputRef,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onSend: (text: string) => void;
  streaming: boolean;
  showClear: boolean;
  onClear: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useApp();

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend(draft);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={t("assistantPlaceholder")}
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-md border border-border bg-canvas px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-ink-dim focus:border-primary/60"
        />
        <Button
          size="icon"
          onClick={() => onSend(draft)}
          disabled={streaming || !draft.trim()}
          aria-label={t("assistantSend")}
          title={t("assistantSend")}
        >
          {streaming ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <SendHorizontal size={16} />
          )}
        </Button>
      </div>
      {showClear && (
        <button
          onClick={onClear}
          className="flex items-center gap-1.5 text-[11px] text-ink-dim transition-colors hover:text-foreground"
        >
          <Trash2 size={12} />
          {t("assistantClear")}
        </button>
      )}
    </div>
  );
}
