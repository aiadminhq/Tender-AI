// 小助手 runtime 橋接：把自建的 useAssistantChat（NDJSON 串流＋grounding＋四類來源）
// 接到 @assistant-ui/react 的 external store runtime，讓官方 Thread / Modal 元件庫
// 能直接驅動我們的後端，而不必自建對話狀態機。浮窗 AssistantModal 與整頁
// 指揮中心 AssistantPage 共用同一個 runtime（各自帶 scope 區隔埋點）。
//
// 串流機制：useAssistantChat.patchLastAssistant 以 {...prev, ...patch} 產生新的 turn
// 物件參照 → useExternalStoreRuntime 的參照比對快取會對該 turn 重跑 convertMessage →
// 累積全文（delta 為 replace 非 append）即時更新渲染。
import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { AssistantSource, PreferenceSuggestion } from "@/lib/assistant";
import { useAssistantChat, type Turn } from "./use-assistant-chat";

// 我們塞進 message.metadata.custom 的形狀；Thread 自訂渲染器讀回來組來源清單／錯誤態／偏好確認 chip。
export interface AssistantCustomMeta {
  sources: AssistantSource[] | null;
  error: boolean;
  preference: PreferenceSuggestion | null;
  preferenceState: "pending" | "confirmed" | "dismissed" | null;
}

interface AssistantBridge {
  scope: string;
  onSourceClick: (s: AssistantSource) => void;
  /** 偏好確認 chip：使用者按「好」記住／「不用」忽略。 */
  resolvePreference: (
    pref: PreferenceSuggestion,
    action: "confirm" | "dismiss",
  ) => void;
  clear: () => void;
  hasTurns: boolean;
  suggestions: string[];
  /** agentic（CLI 大腦）暫態狀態行（「正在查詢…」）；非 CLI 大腦或非串流時為 null。 */
  progress: string | null;
}

const BridgeContext = createContext<AssistantBridge | null>(null);

/** 取得橋接情境（來源點擊埋點、清除、建議題、是否已有對話）。須在 <AssistantRuntime> 內。 */
export function useAssistantBridge(): AssistantBridge {
  const ctx = useContext(BridgeContext);
  if (!ctx)
    throw new Error("useAssistantBridge 必須在 <AssistantRuntime> 內使用");
  return ctx;
}

const convertMessage = (turn: Turn): ThreadMessageLike => ({
  role: turn.role,
  content: turn.text,
  metadata: {
    custom: {
      sources: turn.sources ?? null,
      error: turn.error ?? false,
      preference: turn.preference ?? null,
      preferenceState: turn.preferenceState ?? null,
    } satisfies AssistantCustomMeta,
  },
});

/** 包住一段 UI，提供 assistant-ui runtime（串接後端串流）與橋接情境。 */
export function AssistantRuntime({
  scope,
  focusTenderId = null,
  children,
}: {
  scope: string;
  /** 使用者目前正在檢視的標案 id（情境感知接線）；浮窗/指揮中心由路由帶入。 */
  focusTenderId?: string | null;
  children: ReactNode;
}) {
  const {
    turns,
    streaming,
    progress,
    send,
    stop,
    clear,
    onSourceClick,
    resolvePreference,
    suggestions,
  } = useAssistantChat(scope, focusTenderId);

  const runtime = useExternalStoreRuntime({
    messages: turns,
    isRunning: streaming,
    convertMessage,
    onNew: async (message: AppendMessage) => {
      const text = message.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      await send(text);
    },
    onCancel: async () => stop(),
    suggestions: suggestions.map((prompt) => ({ prompt })),
  });

  const bridge = useMemo<AssistantBridge>(
    () => ({
      scope,
      onSourceClick,
      resolvePreference,
      clear,
      hasTurns: turns.length > 0,
      suggestions,
      progress,
    }),
    [
      scope,
      onSourceClick,
      resolvePreference,
      clear,
      turns.length,
      suggestions,
      progress,
    ],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <BridgeContext.Provider value={bridge}>{children}</BridgeContext.Provider>
    </AssistantRuntimeProvider>
  );
}
