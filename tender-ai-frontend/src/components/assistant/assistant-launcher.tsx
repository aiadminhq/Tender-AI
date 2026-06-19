// 標案知識小助手：topbar 觸發鈕 + 右側 Sheet 對話面板。
// 串接後端 POST /assistant/chat（lib/assistant.ts，NDJSON 串流；delta.text 為累積全文 → replace）。
// 行為埋點（lib/events.ts）：開啟=view、提問=search、點來源=click_link，餵養 Layer C 自我學習訊號。
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Bot,
  ExternalLink,
  Loader2,
  SendHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useApp } from "@/store/app-context";
import type { TextKey } from "@/i18n/strings";
import { trackEvent } from "@/lib/events";
import {
  streamAssistantChat,
  type AssistantSource,
  type ChatMessage,
} from "@/lib/assistant";
import { RichText } from "./rich-text";
import { cn } from "@/lib/utils";

interface Turn {
  role: "user" | "assistant";
  text: string;
  sources?: AssistantSource[];
  error?: boolean;
}

// 來源類別 → i18n 字串鍵；知識庫類另渲染不同樣式（見 SourceChip）。
const KIND_KEY: Record<AssistantSource["kind"], TextKey> = {
  tender: "assistantKindTender",
  semantic: "assistantKindSemantic",
  similar: "assistantKindSimilar",
  knowledge: "assistantKindKnowledge",
};

export function AssistantLauncher() {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // 自動捲到底（新訊息 / 串流更新時）。
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [turns, streaming]);

  // 開啟時聚焦輸入框，並記一筆 view 事件。
  useEffect(() => {
    if (!open) return;
    trackEvent("view", { payload: { scope: "assistant_open" } });
    const id = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  // 卸載 / 關閉時中止進行中的串流。
  useEffect(() => () => abortRef.current?.abort(), []);

  const patchLastAssistant = useCallback((patch: Partial<Turn>) => {
    setTurns((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") {
          next[i] = { ...next[i], ...patch };
          break;
        }
      }
      return next;
    });
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const prompt = raw.trim();
      if (!prompt || streaming) return;

      // 既有對話 + 本次提問 → 後端取最後 user 訊息為主，但帶全歷史。
      const history: ChatMessage[] = [
        ...turns.map((x) => ({ role: x.role, text: x.text })),
        { role: "user" as const, text: prompt },
      ];
      setTurns((prev) => [
        ...prev,
        { role: "user", text: prompt },
        { role: "assistant", text: "" },
      ]);
      setDraft("");
      setStreaming(true);
      trackEvent("search", { payload: { scope: "assistant", q: prompt } });

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        await streamAssistantChat(
          history,
          {
            onMeta: (_scope, sources) => patchLastAssistant({ sources }),
            onText: (full) => patchLastAssistant({ text: full }),
            onDone: () => setStreaming(false),
          },
          ctrl.signal,
        );
      } catch {
        patchLastAssistant({ text: t("assistantError"), error: true });
      } finally {
        setStreaming(false);
      }
    },
    [turns, streaming, patchLastAssistant, t],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  };

  const clear = () => {
    abortRef.current?.abort();
    setStreaming(false);
    setTurns([]);
    setDraft("");
    inputRef.current?.focus();
  };

  const onSourceClick = (s: AssistantSource) => {
    // 知識庫來源無 tenderId（tenderId 為 null）→ 不帶 tenderId，改記 docId/heading。
    trackEvent("click_link", {
      ...(s.tenderId != null ? { tenderId: String(s.tenderId) } : {}),
      payload: {
        scope: "assistant",
        kind: s.kind,
        source: s.source,
        ...(s.docId ? { docId: s.docId } : {}),
        ...(s.heading ? { heading: s.heading } : {}),
      },
    });
  };

  const suggestions = [
    t("assistantSuggest1"),
    t("assistantSuggest2"),
    t("assistantSuggest3"),
    t("assistantSuggest4"),
  ];

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={t("assistantOpen")}
        title={t("assistantOpen")}
        className="relative text-primary"
      >
        <Bot size={17} />
      </Button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        width="sm:max-w-lg"
        title={
          <span className="flex items-center gap-2">
            <Sparkles size={15} className="text-primary" />
            {t("assistantTitle")}
          </span>
        }
        footer={
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
                onClick={() => void send(draft)}
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
            {turns.length > 0 && (
              <button
                onClick={clear}
                className="flex items-center gap-1.5 text-[11px] text-ink-dim transition-colors hover:text-foreground"
              >
                <Trash2 size={12} />
                {t("assistantClear")}
              </button>
            )}
          </div>
        }
      >
        <div ref={bodyRef} className="flex h-full flex-col gap-4">
          {turns.length === 0 ? (
            <div className="space-y-4 py-2">
              <p className="text-[13px] leading-relaxed text-ink-muted">
                {t("assistantEmpty")}
              </p>
              <div className="flex flex-col gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
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
          ) : (
            turns.map((turn, i) =>
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
                          <p className="text-[13px] leading-relaxed">
                            {turn.text}
                          </p>
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
            )
          )}
        </div>
      </Sheet>
    </>
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
