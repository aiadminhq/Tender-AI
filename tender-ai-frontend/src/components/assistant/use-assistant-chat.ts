// 小助手對話狀態與串流邏輯（浮窗 AssistantLauncher 與整頁 AssistantPage 共用）。
// 封裝：對話列、草稿、串流中止、patch 最後一則 assistant、送出／清除、來源點擊埋點。
// 串接 lib/assistant.ts（NDJSON 串流；delta.text 為累積全文 → 直接 replace）。
// 行為埋點（lib/events.ts）：提問=search、點來源=click_link，scope 由呼叫端帶入區隔浮窗／整頁。
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/store/app-context";
import { trackEvent } from "@/lib/events";
import {
  streamAssistantChat,
  type AssistantSource,
  type ChatMessage,
} from "@/lib/assistant";

export interface Turn {
  role: "user" | "assistant";
  text: string;
  sources?: AssistantSource[];
  error?: boolean;
}

export function useAssistantChat(scope: string) {
  const { t } = useApp();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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
      trackEvent("search", { payload: { scope, q: prompt } });

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
    [turns, streaming, patchLastAssistant, t, scope],
  );

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
    setTurns([]);
    setDraft("");
    inputRef.current?.focus();
  }, []);

  const onSourceClick = useCallback(
    (s: AssistantSource) => {
      // 知識庫來源無 tenderId → 不帶 tenderId，改記 docId/heading。
      trackEvent("click_link", {
        ...(s.tenderId != null ? { tenderId: String(s.tenderId) } : {}),
        payload: {
          scope,
          kind: s.kind,
          source: s.source,
          ...(s.docId ? { docId: s.docId } : {}),
          ...(s.heading ? { heading: s.heading } : {}),
        },
      });
    },
    [scope],
  );

  const suggestions = [
    t("assistantSuggest1"),
    t("assistantSuggest2"),
    t("assistantSuggest3"),
    t("assistantSuggest4"),
  ];

  return {
    turns,
    draft,
    setDraft,
    streaming,
    send,
    clear,
    onSourceClick,
    suggestions,
    inputRef,
  };
}
