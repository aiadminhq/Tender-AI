import { createContext, useContext } from "react";
import type {
  AssistantSource,
  AssistantThreadSummary,
  PreferenceSuggestion,
} from "@/lib/assistant";

export interface AssistantBridge {
  scope: string;
  /** 直接送出一則提問（供外部入口如選區選單「傳送給 AI」呼叫）。 */
  send: (text: string) => void;
  onSourceClick: (s: AssistantSource) => void;
  /** 偏好確認 chip：使用者按「好」記住／「不用」忽略。 */
  resolvePreference: (
    pref: PreferenceSuggestion,
    action: "confirm" | "dismiss",
  ) => void;
  clear: () => void;
  newChat: () => void;
  loadThread: (threadId: string) => Promise<boolean>;
  refreshThreads: (query?: string) => Promise<AssistantThreadSummary[]>;
  threads: AssistantThreadSummary[];
  threadsLoading: boolean;
  activeThreadId: string | null;
  hasTurns: boolean;
  suggestions: string[];
  /** agentic（CLI 大腦）暫態狀態行（「正在查詢…」）；非 CLI 大腦或非串流時為 null。 */
  progress: string | null;
}

export const AssistantBridgeContext =
  createContext<AssistantBridge | null>(null);

/** 取得橋接情境（來源點擊埋點、清除、建議題、是否已有對話）。須在 <AssistantRuntime> 內。 */
export function useAssistantBridge(): AssistantBridge {
  const ctx = useContext(AssistantBridgeContext);
  if (!ctx)
    throw new Error("useAssistantBridge 必須在 <AssistantRuntime> 內使用");
  return ctx;
}
