// 小助手首次聚光導覽（Phase 1，純前端、免 migration）。
// 半透明遮罩 + 聚光圈點亮右下啟動鈕，coach-mark 分步解說；
// 完成或跳過後寫入 localStorage 旗標,之後不再自動跳出。
// 旗標讀寫沿用 assistant-window.tsx 的 try/catch 寫法,隱私模式/quota 滿時靜默降級。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/store/app-context";
import type { TextKey } from "@/i18n/strings";

const ONBOARDED_STORAGE_KEY = "tender-assistant-onboarded";
// app 先繪製、再淡入聚光,避免初次載入閃爍（約半秒）。
const MOUNT_DELAY_MS = 550;

function loadOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_STORAGE_KEY) === "1";
  } catch {
    // 隱私模式或讀取失敗時,當作已看過,寧可不打擾。
    return true;
  }
}

function saveOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_STORAGE_KEY, "1");
  } catch {
    /* 隱私模式或 quota 滿時靜默略過,導覽僅止於本次 session 不再出現。 */
  }
}

const STEPS: { title: TextKey; body: TextKey }[] = [
  { title: "onboardStep1Title", body: "onboardStep1Body" },
  { title: "onboardStep2Title", body: "onboardStep2Body" },
  { title: "onboardStep3Title", body: "onboardStep3Body" },
  { title: "onboardStep4Title", body: "onboardStep4Body" },
];

export function AssistantOnboarding({
  onOpenAssistant,
}: {
  onOpenAssistant: () => void;
}) {
  const { t } = useApp();
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  // 首訪才排程顯示；已看過直接跳過。
  useEffect(() => {
    if (loadOnboarded()) return;
    const id = window.setTimeout(() => setShow(true), MOUNT_DELAY_MS);
    return () => window.clearTimeout(id);
  }, []);

  // 顯示時聚焦卡片、Esc 視為跳過。
  useEffect(() => {
    if (!show) return;
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  const finish = (openAssistant: boolean) => {
    saveOnboarded();
    setShow(false);
    if (openAssistant) onOpenAssistant();
  };

  if (!show) return null;

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  return createPortal(
    // 根層攔截背景點擊(空白處點擊不關閉,需用「跳過」明確退出)。
    <div
      className="fixed inset-0 z-[60] animate-in fade-in"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 聚光圈：自身透明,靠 box-shadow 罩住四周形成「光圈中的啟動鈕」。 */}
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-[4.75rem] right-3 h-14 w-14 rounded-2xl outline outline-2 outline-offset-2 outline-white/85 shadow-[0_0_0_9999px_rgba(15,23,42,0.55)] md:bottom-5 md:right-5"
      />

      {/* 對準啟動鈕的透明熱區：點它＝完成導覽並開啟小助手。 */}
      <button
        type="button"
        aria-label={t("assistantOpen")}
        title={t("assistantOpen")}
        onClick={() => finish(true)}
        className="fixed bottom-20 right-4 h-12 w-12 rounded-2xl md:bottom-6 md:right-6"
      />

      {/* coach-mark 卡片：分步解說 + 上一步／下一步／開始使用／跳過。 */}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("onboardAria")}
        tabIndex={-1}
        className="fixed bottom-36 right-4 z-[61] w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,.06)] outline-none animate-in fade-in slide-in-from-bottom-2 md:bottom-28 md:right-6"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-accent px-2 py-0.5 text-[11px] font-medium text-ink-dim">
            <Sparkles size={11} className="text-primary" />
            {step + 1} / {STEPS.length}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => finish(false)}
            className="text-[12px] text-ink-dim transition-colors hover:text-ink"
          >
            {t("onboardSkip")}
          </button>
        </div>

        <h3 className="mt-3 text-[15px] font-semibold text-ink">
          {t(current.title)}
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">
          {t(current.body)}
        </p>

        <div className="mt-4 flex items-center gap-2">
          {step > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              {t("onboardPrev")}
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="primary"
            size="sm"
            onClick={() => (isLast ? finish(true) : setStep((s) => s + 1))}
          >
            {isLast ? t("onboardStart") : t("onboardNext")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
