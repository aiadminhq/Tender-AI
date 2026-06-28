// 房屋風格化的 assistant-ui Thread：以官方 primitives（ThreadPrimitive / ComposerPrimitive /
// AuiIf / useAuiState）搭出骨架，但渲染層改用本專案的 RichText、四類來源 SourceChip、
// Button 與設計語彙——不採官方 MarkdownText/TooltipIconButton，亦捨棄附件／推理／工具群組／
// 分支切換／聽寫等本專案用不到的零件。浮窗 Modal 與整頁指揮中心共用此元件。
//
// 設計約束：維持白底與既有字體/間距；使用者明確要求 CTA 以不同色彩 + icon 區分。
import { useMemo, useState } from "react";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  CornerDownRight,
  ExternalLink,
  FileText,
  GitCompareArrows,
  GraduationCap,
  Lightbulb,
  Loader2,
  MessageSquareText,
  ScanSearch,
  SendHorizontal,
  Sparkles,
  Square,
  TrendingUp,
  type LucideIcon,
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
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AssistantArtifacts } from "./assistant-artifacts";
import { BrainQuickPicker } from "./brain-quick-picker";
import { RichText } from "./rich-text";
import type { TenderRef } from "./rich-text-links";
import { type AssistantCustomMeta } from "./assistant-runtime-provider";
import { useAssistantBridge } from "./assistant-bridge";

// 來源類別 → i18n 字串鍵 + 代表 icon。類別差異只靠 icon 形狀承載（單色系不疊第二個彩色）。
// 知識庫類另渲染 signal 微調色（與標案的中性 accent 區隔，沿用既有語彙）。
const KIND_META: Record<
  AssistantSource["kind"],
  { key: TextKey; icon: LucideIcon }
> = {
  tender: { key: "assistantKindTender", icon: FileText },
  semantic: { key: "assistantKindSemantic", icon: ScanSearch },
  similar: { key: "assistantKindSimilar", icon: GitCompareArrows },
  knowledge: { key: "assistantKindKnowledge", icon: BookOpen },
};

// 空態建議題依序對應的 icon（高潛力 / 相似案 / 即將截止 / 分級標準）。
const SUGGEST_ICONS: LucideIcon[] = [
  TrendingUp,
  GitCompareArrows,
  Clock,
  GraduationCap,
  ScanSearch,
  FileText,
  BookOpen,
  Lightbulb,
];

const PROMPT_GROUPS: {
  title: TextKey;
  hint: TextKey;
  icon: LucideIcon;
  indexes: number[];
  tone: "amber" | "sky" | "emerald";
}[] = [
  {
    title: "assistantPromptDecision",
    hint: "assistantPromptDecisionHint",
    icon: TrendingUp,
    indexes: [0, 2, 4],
    tone: "amber",
  },
  {
    title: "assistantPromptCompare",
    hint: "assistantPromptCompareHint",
    icon: GitCompareArrows,
    indexes: [1, 5],
    tone: "sky",
  },
  {
    title: "assistantPromptExplain",
    hint: "assistantPromptExplainHint",
    icon: BookOpen,
    indexes: [3, 6, 7],
    tone: "emerald",
  },
];

const COMPOSER_SHORTCUTS: {
  label: TextKey;
  prompt: TextKey;
  icon: LucideIcon;
  tone: "sky" | "amber" | "emerald";
}[] = [
  {
    label: "assistantModeSearch",
    prompt: "assistantSuggest1",
    icon: ScanSearch,
    tone: "sky",
  },
  {
    label: "assistantModeCompare",
    prompt: "assistantAskCompare",
    icon: GitCompareArrows,
    tone: "amber",
  },
  {
    label: "assistantModeBrief",
    prompt: "assistantAskFit",
    icon: MessageSquareText,
    tone: "emerald",
  },
];

const CTA_TONES = {
  amber: {
    shell:
      "border-amber-200 bg-white hover:border-amber-300 hover:shadow-[0_14px_28px_-22px_rgba(180,83,9,.7)]",
    icon: "bg-amber-50 text-amber-700",
    row: "hover:border-amber-200 hover:bg-amber-50",
    arrow: "text-amber-600",
  },
  sky: {
    shell:
      "border-sky-200 bg-white hover:border-sky-300 hover:shadow-[0_14px_28px_-22px_rgba(2,132,199,.7)]",
    icon: "bg-sky-50 text-sky-700",
    row: "hover:border-sky-200 hover:bg-sky-50",
    arrow: "text-sky-600",
  },
  emerald: {
    shell:
      "border-emerald-200 bg-white hover:border-emerald-300 hover:shadow-[0_14px_28px_-22px_rgba(4,120,87,.7)]",
    icon: "bg-emerald-50 text-emerald-700",
    row: "hover:border-emerald-200 hover:bg-emerald-50",
    arrow: "text-emerald-600",
  },
};

const FOLLOWUP_TONES = [
  "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 hover:border-orange-300",
  "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:border-sky-300",
  "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300",
];

const isNewChatView = (s: AssistantState) => s.thread.messages.length === 0;

// 答後主動延伸提問的顯示條件：非串流中、最後一則為 assistant、有實際文字且非錯誤態。
const canFollowUp = (s: AssistantState) => {
  if (s.thread.isRunning) return false;
  const msgs = s.thread.messages;
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== "assistant") return false;
  const meta = last.metadata?.custom as unknown as
    | AssistantCustomMeta
    | undefined;
  if (meta?.error) return false;
  const text = last.content
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
  return text.trim().length > 0;
};

/** 整個對話串（含空態建議、訊息列、答後延伸提問、底部 composer）。寬度由外層容器決定。 */
export function AssistantUIThread() {
  const { t } = useApp();

  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col bg-white">
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
        <AuiIf condition={canFollowUp}>
          <ThreadFollowups />
        </AuiIf>
      </ThreadPrimitive.Viewport>

      <ThreadPrimitive.ViewportFooter className="border-t border-border bg-white px-4 py-3">
        <Composer placeholder={t("assistantPlaceholder")} />
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Root>
  );
}

/** 空態：提示語 + 四個建議題（點擊即送出），每題帶情境 icon。 */
function ThreadEmpty() {
  const { t } = useApp();
  const { suggestions } = useAssistantBridge();
  return (
    <div className="space-y-4 py-1">
      <div className="rounded-xl border border-orange-100 bg-white px-4 py-4 shadow-[0_14px_30px_-26px_rgba(234,88,12,.55)]">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-orange-50 text-orange-700">
            <Sparkles size={17} />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 className="text-[14px] font-semibold leading-tight text-ink">
              {t("assistantWorkbenchTitle")}
            </h2>
            <p className="text-[12px] leading-relaxed text-ink-muted">
              {t("assistantEmpty")}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {PROMPT_GROUPS.map((group) => {
          const GroupIcon = group.icon;
          const tone = CTA_TONES[group.tone];
          const prompts = group.indexes
            .map((index) => suggestions[index])
            .filter(Boolean);
          if (prompts.length === 0) return null;

          return (
            <section
              key={group.title}
              className={cn(
                "rounded-xl border p-2.5 transition-all hover:-translate-y-0.5",
                tone.shell,
              )}
            >
              <div className="mb-2 flex items-center gap-2 px-1">
                <span
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-md",
                    tone.icon,
                  )}
                >
                  <GroupIcon size={13} />
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-foreground/90">
                    {t(group.title)}
                  </p>
                  <p className="truncate text-[10px] text-ink-dim">
                    {t(group.hint)}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {prompts.map((s, i) => {
                  const Icon = SUGGEST_ICONS[group.indexes[i]] ?? Sparkles;
                  return (
                    <ThreadPrimitive.Suggestion
                      key={s}
                      prompt={s}
                      send
                      clearComposer
                      className={cn(
                        "group flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left text-[12px] text-foreground/90 transition-all hover:-translate-y-0.5 active:translate-y-0 active:scale-[.99]",
                        tone.row,
                      )}
                    >
                      <Icon
                        size={13}
                        className={cn("shrink-0 transition-colors", tone.arrow)}
                      />
                      <span className="min-w-0 flex-1">{s}</span>
                      <ArrowUp
                        size={12}
                        className={cn(
                          "shrink-0 rotate-45 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100",
                          tone.arrow,
                        )}
                      />
                    </ThreadPrimitive.Suggestion>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** 答後主動延伸提問：一行標題 + 三個追問 chip（點擊即送出）。提升小助手主動性。 */
function ThreadFollowups() {
  const { t } = useApp();
  const followups = [
    t("assistantFollowup1"),
    t("assistantFollowup2"),
    t("assistantFollowup3"),
  ];
  return (
    <div className="ml-[38px] space-y-2 rounded-xl border border-border bg-white p-2.5 shadow-[0_10px_24px_-24px_rgba(15,23,42,.45)]">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-dim">
        <Lightbulb size={12} className="shrink-0" />
        {t("assistantFollowupTitle")}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {followups.map((f, i) => (
          <ThreadPrimitive.Suggestion
            key={f}
            prompt={f}
            send
            clearComposer
            className={cn(
              "group inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_20px_-18px_rgba(15,23,42,.55)] active:translate-y-0 active:scale-[.97]",
              FOLLOWUP_TONES[i] ?? FOLLOWUP_TONES[0],
            )}
          >
            <CornerDownRight
              size={12}
              className="shrink-0 opacity-80 transition-transform group-hover:translate-x-0.5"
            />
            {f}
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
      artifacts: [],
    }
  );
}

function UserMessage() {
  const text = useMessageText();
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-slate-900 px-3.5 py-2 text-[13px] leading-relaxed text-white">
        {text}
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  const { t } = useApp();
  const { onSourceClick, progress } = useAssistantBridge();
  const text = useMessageText();
  const { sources, error, preference, preferenceState, artifacts } =
    useMessageMeta();
  const sourceCount = sources?.length ?? 0;

  // 本則回答已引用的標案（id→標題），供 RichText 把答案內文的「#<id> 標題」連到詳情頁。
  // 只認已引用的 id，確保不會連到不存在／未檢索的案子（死連結）。
  const tenderRefs = useMemo(() => {
    const seen = new Set<string>();
    const refs: TenderRef[] = [];
    for (const s of sources ?? []) {
      if (!s.title || (s.tenderId == null && !s.url)) continue;
      const key = s.tenderId != null ? `id:${s.tenderId}` : `url:${s.url}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({
          id: s.tenderId,
          title: s.title,
          url: s.url,
          source: s.source,
        });
      }
    }
    return refs;
  }, [sources]);

  // 串流期間（尚無答案文字）改顯示「正在依 N 筆證據作答…」的 grounding 行，
  // 而非把整面來源 chip 牆傾倒在 loading 卡下方（這正是先前「割裂」的根因）。
  const loadingLabel =
    progress ??
    (sourceCount > 0
      ? t("assistantGrounding").replace("{n}", String(sourceCount))
      : t("assistantThinking"));

  return (
    <MessagePrimitive.Root className="flex gap-2.5">
      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-signal/12 text-signal">
        <Sparkles size={15} />
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        {text ? (
          <div
            className={cn(
              "rounded-xl rounded-tl-sm border border-border bg-card px-3.5 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,.03)]",
              error && "text-danger",
            )}
          >
            {error ? (
              <p className="text-[13px] leading-relaxed">{text}</p>
            ) : (
              <RichText text={text} tenderRefs={tenderRefs} />
            )}
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-xl rounded-tl-sm border border-border bg-card px-3.5 py-2.5 text-[12px] text-ink-muted">
            <Loader2 size={13} className="animate-spin text-signal" />
            {loadingLabel}
          </div>
        )}
        {/* 來源只在答案出現後、以可收合區塊呈現（預設收合，標題列帶筆數＋類別 icon 預覽）。 */}
        {!error && text && sourceCount > 0 && sources && (
          <SourceSection sources={sources} onSourceClick={onSourceClick} />
        )}
        {!error && artifacts.length > 0 && (
          <AssistantArtifacts artifacts={artifacts} />
        )}
        {preference && preferenceState && preferenceState !== "dismissed" && (
          <PreferenceChip preference={preference} state={preferenceState} />
        )}
      </div>
    </MessagePrimitive.Root>
  );
}

/** 可收合的引用來源區：收合時僅一行（筆數＋去重類別 icon 預覽），展開列出帶 icon 的來源 chip。 */
function SourceSection({
  sources,
  onSourceClick,
}: {
  sources: AssistantSource[];
  onSourceClick: (s: AssistantSource) => void;
}) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const uniqueKinds = [...new Set(sources.map((s) => s.kind))];

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-left transition-colors hover:border-sky-200 hover:bg-sky-50"
      >
        <ChevronRight
          size={14}
          className={cn(
            "shrink-0 text-ink-dim transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[12px] text-ink-muted">
            {t("assistantSourcesCount").replace("{n}", String(sources.length))}
          </span>
          <span className="truncate text-[10px] text-ink-dim">
            {t("assistantEvidenceHint")}
          </span>
        </span>
        {!open && (
          <span className="ml-auto flex items-center gap-1">
            {uniqueKinds.map((k) => {
              const Icon = KIND_META[k].icon;
              return <Icon key={k} size={12} className="text-ink-dim" />;
            })}
          </span>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-1.5">
          {sources.map((s, j) => (
            <SourceChip
              key={`${s.tenderId ?? s.docId ?? "k"}-${s.kind}-${j}`}
              source={s}
              onClick={() => onSourceClick(s)}
            />
          ))}
        </div>
      )}
    </div>
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
      <Alert
        variant="info"
        align="center"
        className="gap-1.5 rounded-2xl"
        icon={<Check size={13} />}
      >
        {t("assistantPrefSaved")}
      </Alert>
    );
  }

  const question = (
    preference.op === "only"
      ? t("assistantPrefAskOnly")
      : t("assistantPrefAskExclude")
  ).replace("{region}", preference.value);

  return (
    <div className="space-y-2 rounded-2xl border border-signal/30 bg-signal/8 px-3.5 py-3">
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
  const { icon: Icon, key } = KIND_META[source.kind];

  // icon 容器：知識庫用 signal 微調色（與標案的中性 accent 區隔，沿用既有語彙），其餘中性。
  const iconCls = isKnowledge
    ? "bg-orange-50 text-orange-700"
    : "bg-slate-100 text-slate-600";
  // 次行：知識庫顯示 heading，標案類顯示資料源（source）。
  const sub = isKnowledge ? source.heading : source.source;

  const inner = (
    <>
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-lg",
          iconCls,
        )}
      >
        <Icon size={14} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12px] text-foreground/90">
          {source.title}
        </span>
        <span className="truncate text-[10px] text-ink-dim">
          {t(key)}
          {sub ? ` · ${sub}` : ""}
        </span>
      </span>
      {!isKnowledge && source.url && (
        <ExternalLink size={12} className="shrink-0 text-ink-dim" />
      )}
    </>
  );
  const cls =
    "flex items-center gap-2.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-left transition-all hover:-translate-y-0.5 hover:border-sky-200 hover:bg-sky-50 hover:shadow-[0_10px_22px_-18px_rgba(15,23,42,.55)] active:translate-y-0";
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
    <div className="space-y-2">
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
        {COMPOSER_SHORTCUTS.map(({ label, prompt, icon: Icon, tone }) => {
          const color =
            tone === "sky"
              ? "border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100"
              : tone === "amber"
                ? "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100"
                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100";
          return (
            <ThreadPrimitive.Suggestion
              key={label}
              prompt={t(prompt)}
              send
              clearComposer
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_20px_-18px_rgba(15,23,42,.6)] active:translate-y-0 active:scale-[.98]",
                color,
              )}
            >
              <Icon size={12} />
              {t(label)}
            </ThreadPrimitive.Suggestion>
          );
        })}
      </div>
      <ComposerPrimitive.Root className="flex items-end gap-2 rounded-xl border border-border bg-white p-1.5 transition-all hover:border-orange-200 focus-within:border-orange-300 focus-within:ring-2 focus-within:ring-orange-100">
        <ComposerPrimitive.Input
          autoFocus
          rows={1}
          submitOnEnter
          placeholder={placeholder}
          aria-label={placeholder}
          className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-dim"
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
            <Button
              size="icon"
              variant="outline"
              title={t("assistantThinking")}
            >
              <Square size={15} />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </ComposerPrimitive.Root>
      <div className="flex items-center">
        <BrainQuickPicker />
      </div>
    </div>
  );
}
