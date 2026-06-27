// 小助手對話狀態與串流邏輯（浮窗 AssistantLauncher 與整頁 AssistantPage 共用）。
// 封裝：對話列、草稿、串流中止、patch 最後一則 assistant、送出／清除、來源點擊埋點。
// 串接 lib/assistant.ts（NDJSON 串流；delta.text 為累積全文 → 直接 replace）。
// 行為埋點（lib/events.ts）：提問=search、點來源=click_link，scope 由呼叫端帶入區隔浮窗／整頁。
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/store/app-context";
import { trackEvent } from "@/lib/events";
import {
  streamAssistantChat,
  fetchAssistantThreads,
  fetchAssistantThread,
  type AssistantThreadSummary,
  type AssistantSource,
  type ChatMessage,
  type PreferenceSuggestion,
} from "@/lib/assistant";

export interface Turn {
  role: "user" | "assistant";
  text: string;
  sources?: AssistantSource[];
  error?: boolean;
  /** 此回合偵測到的長期條件建議（confirm-to-remember）；null/未定義＝無。 */
  preference?: PreferenceSuggestion | null;
  /** 偏好建議的處理狀態：待確認／已記住／不用。預設 pending（有 preference 時）。 */
  preferenceState?: "pending" | "confirmed" | "dismissed";
}

export function useAssistantChat(scope: string, focusTenderId?: string | null) {
  const { t } = useApp();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [threads, setThreads] = useState<AssistantThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  // agentic（CLI 大腦）暫態狀態：「正在查詢…」狀態行。收到下一筆 delta 或 done 即清空，
  // 不寫入對話文字（見 lib/assistant.ts ProgressEvent）。非 CLI 大腦不會送 progress，恆為 null。
  const [progress, setProgress] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // 對話留存：本次 session 的對話串 id。首次提問由後端於 meta 回傳並記下，
  // 後續同串提問帶回去續接；clear() 視為開新串而清空。
  const threadIdRef = useRef<string | null>(null);

  // 「目前正在檢視的標案」放 ref：使用者可能在對話途中切換標案，send 時讀最新值即可，
  // 不必把它列入 send 的依賴而頻繁重建 callback。
  const focusRef = useRef<string | null>(focusTenderId ?? null);

  // 卸載 / 關閉時中止進行中的串流。
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    focusRef.current = focusTenderId ?? null;
  }, [focusTenderId]);

  const refreshThreads = useCallback(async (query?: string) => {
    setThreadsLoading(true);
    try {
      const next = await fetchAssistantThreads(query);
      setThreads(next);
      return next;
    } catch {
      setThreads([]);
      return [];
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  const loadThread = useCallback(async (threadId: string) => {
    const detail = await fetchAssistantThread(threadId);
    if (!detail) return false;
    abortRef.current?.abort();
    setProgress(null);
    setStreaming(false);
    threadIdRef.current = detail.id;
    setActiveThreadId(detail.id);
    setDraft("");
    setTurns(
      detail.turns.map((tn) => ({
        role: tn.role,
        text: tn.text,
        sources: tn.sources,
      })),
    );
    inputRef.current?.focus();
    return true;
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setProgress(null);
    setStreaming(false);
    setTurns([]);
    setDraft("");
    threadIdRef.current = null;
    setActiveThreadId(null);
    inputRef.current?.focus();
  }, []);

  // 掛載時 hydrate 最近一串對話，讓使用者回到上次對話脈絡；同時保留歷史清單供 UI 查詢。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const recent = await refreshThreads();
      const latest = recent[0];
      if (!latest || cancelled) return;
      await loadThread(latest.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadThread, refreshThreads]);

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
            onMeta: (_scope, sources, threadId) => {
              if (threadId) {
                threadIdRef.current = threadId;
                setActiveThreadId(threadId);
              }
              patchLastAssistant({ sources });
            },
            onText: (full) => {
              setProgress(null);
              patchLastAssistant({ text: full });
            },
            onProgress: (status) => setProgress(status),
            onPreferenceSuggestion: (suggestion) =>
              patchLastAssistant(
                suggestion
                  ? { preference: suggestion, preferenceState: "pending" }
                  : {},
              ),
            onDone: () => {
              setProgress(null);
              setStreaming(false);
              void refreshThreads();
            },
          },
          ctrl.signal,
          focusRef.current,
          { threadId: threadIdRef.current, scope },
        );
      } catch {
        // 使用者主動中止（stop/clear）不算錯誤，不覆寫已串流內容。
        if (!ctrl.signal.aborted) {
          patchLastAssistant({ text: t("assistantError"), error: true });
        }
      } finally {
        setProgress(null);
        setStreaming(false);
      }
    },
    [turns, streaming, patchLastAssistant, refreshThreads, t, scope],
  );

  // 中止進行中的串流但保留已產生的對話（供 assistant-ui onCancel 串接）。
  const stop = useCallback(() => {
    abortRef.current?.abort();
    setProgress(null);
    setStreaming(false);
  }, []);

  const clear = useCallback(() => {
    newChat();
  }, [newChat]);

  // 確認後才記：使用者按「好」→ POST 一筆具名 state_preference 事件（fire-and-forget），
  // 按「不用」→ 僅關閉 chip、不入庫。兩者都把該回合的偏好狀態定下來避免重複詢問。
  // 入庫只是「共享軟訊號」，由後端 learn_keywords 依真實 lift 漸進調整，不立即硬擋。
  const resolvePreference = useCallback(
    (pref: PreferenceSuggestion, action: "confirm" | "dismiss") => {
      if (action === "confirm") {
        trackEvent("state_preference", {
          payload: {
            scope,
            kind: pref.kind,
            op: pref.op,
            value: pref.value,
            raw: pref.raw,
            via: "assistant_confirm",
          },
        });
      }
      setTurns((prev) =>
        prev.map((tn) =>
          tn.role === "assistant" &&
          tn.preferenceState === "pending" &&
          tn.preference?.raw === pref.raw &&
          tn.preference?.kind === pref.kind &&
          tn.preference?.value === pref.value
            ? {
                ...tn,
                preferenceState:
                  action === "confirm" ? "confirmed" : "dismissed",
              }
            : tn,
        ),
      );
    },
    [scope],
  );

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
    t("assistantSuggest5"),
    t("assistantSuggest6"),
    t("assistantSuggest7"),
    t("assistantSuggest8"),
  ];

  return {
    turns,
    draft,
    setDraft,
    streaming,
    progress,
    send,
    stop,
    clear,
    newChat,
    loadThread,
    refreshThreads,
    threads,
    threadsLoading,
    activeThreadId,
    onSourceClick,
    resolvePreference,
    suggestions,
    inputRef,
  };
}
