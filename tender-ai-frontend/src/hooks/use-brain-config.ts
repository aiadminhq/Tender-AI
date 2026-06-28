// 共享「小助手大腦」狀態的 module-level store。
// 設定頁（BrainPicker）與對話內 quick-picker（BrainQuickPicker）共用同一份狀態：
// 任一處儲存成功後，另一處立即反映「目前大腦」，毋須重抓或 props 串接。
// 用 useSyncExternalStore 訂閱；secret 紅線同 lib/brain（金鑰本體永不進前端）。
import { useSyncExternalStore } from "react";
import {
  fetchBrainConfig,
  fetchBrainAgents,
  type BrainAgentSpec,
  type BrainConfig,
} from "@/lib/brain";

interface BrainStore {
  config: BrainConfig | null;
  agents: BrainAgentSpec[];
  loaded: boolean; // 是否已嘗試載入過（成功或失敗皆置 true）
  error: boolean;
}

let state: BrainStore = {
  config: null,
  agents: [],
  loaded: false,
  error: false,
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(patch: Partial<BrainStore>) {
  state = { ...state, ...patch };
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): BrainStore {
  return state;
}

let loadPromise: Promise<void> | null = null;

/** 載入一次大腦設定＋代理清單（多元件共用同一次請求）。失敗不拋，置 error。 */
export function ensureBrainLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const [config, agents] = await Promise.all([
        fetchBrainConfig(),
        fetchBrainAgents(),
      ]);
      setState({ config, agents, loaded: true, error: false });
    } catch {
      setState({ loaded: true, error: true });
    }
  })();
  return loadPromise;
}

/** 套用一份新設定（任一 picker 儲存成功後呼叫，全域同步「目前大腦」）。 */
export function applyBrainUpdate(config: BrainConfig) {
  setState({ config, loaded: true, error: false });
}

/** 強制重抓（少用；一般以 applyBrainUpdate 同步即可）。 */
export function reloadBrain(): Promise<void> {
  loadPromise = null;
  return ensureBrainLoaded();
}

/** 訂閱共享大腦狀態；首次掛載自動觸發載入。 */
export function useBrainStore(): BrainStore {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!snap.loaded && !loadPromise) {
    void ensureBrainLoaded();
  }
  return snap;
}
