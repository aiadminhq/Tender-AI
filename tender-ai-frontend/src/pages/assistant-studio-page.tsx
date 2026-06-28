import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Code2,
  Copy,
  Database,
  FileSearch,
  FileText,
  GitCompareArrows,
  History,
  Info,
  Layers3,
  Library,
  Lightbulb,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  PanelRight,
  Paperclip,
  Search,
  SendHorizontal,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  type LucideIcon as IconType,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type LibraryTab = "components" | "functions" | "prompts";
type MessageRole = "user" | "assistant";
type Tone = "signal" | "success" | "danger" | "muted";

interface StudioThread {
  id: string;
  title: string;
  scope: string;
  active?: boolean;
  unread?: number;
  time: string;
  score: number;
}

interface StudioMessage {
  id: string;
  role: MessageRole;
  author: string;
  time: string;
  text: string;
  chips?: string[];
}

interface ToolStep {
  id: string;
  label: string;
  detail: string;
  status: "done" | "running" | "queued";
  icon: IconType;
}

interface SourceCard {
  id: string;
  kind: string;
  title: string;
  meta: string;
  score: number;
  excerpt: string;
}

interface LibraryItem {
  id: string;
  tab: LibraryTab;
  name: string;
  description: string;
  tags: string[];
  icon: IconType;
  copy: string;
}

const threads: StudioThread[] = [
  {
    id: "north-hospital",
    title: "北區醫院室內裝修案評估",
    scope: "指揮中心",
    active: true,
    unread: 2,
    time: "09:42",
    score: 86,
  },
  {
    id: "school-hvac",
    title: "校園空調汰換相似案比較",
    scope: "相似案",
    time: "昨天",
    score: 74,
  },
  {
    id: "qualification-risk",
    title: "資格限制與履約風險整理",
    scope: "規則解釋",
    time: "週二",
    score: 69,
  },
];

const messages: StudioMessage[] = [
  {
    id: "m1",
    role: "user",
    author: "Christian",
    time: "09:40",
    text: "這件醫院室內裝修案適合 HQdesign 投嗎？請先看資格、預算、截止日與過去相似案。",
    chips: ["醫院", "室內裝修", "資格評估"],
  },
  {
    id: "m2",
    role: "assistant",
    author: "Tender AI",
    time: "09:41",
    text:
      "建議列為必看，但不直接進入投標。主因是預算與 HQdesign 過往承接規模接近，且標案內容偏室內裝修與機電協調；風險在資格文件要求較細，需先確認近期實績與醫療場域施工經驗是否可完整佐證。",
    chips: ["必看", "先補資格", "需人工確認"],
  },
];

const toolSteps: ToolStep[] = [
  {
    id: "sql",
    label: "讀取標案詳情",
    detail: "抓取公告、預算、截止日、資格條件與機關資訊",
    status: "done",
    icon: Database,
  },
  {
    id: "semantic",
    label: "語意檢索",
    detail: "以醫院裝修、病房整修、機電協調搜尋相近歷史案",
    status: "done",
    icon: FileSearch,
  },
  {
    id: "compare",
    label: "相似案比較",
    detail: "比對履約期限、得標金額、資格限制與風險詞",
    status: "running",
    icon: GitCompareArrows,
  },
  {
    id: "brief",
    label: "產出決策摘要",
    detail: "彙整成必看 / 可追 / 先略過與待確認清單",
    status: "queued",
    icon: Brain,
  },
];

const sources: SourceCard[] = [
  {
    id: "s1",
    kind: "標案",
    title: "某醫院 3 樓病房整修統包工程",
    meta: "工程類 · 截止 7 天內 · 預算 820 萬",
    score: 91,
    excerpt: "資格需具備室內裝修業登記，並提出近 5 年醫療院所施工或相關履約證明。",
  },
  {
    id: "s2",
    kind: "相似案",
    title: "北部醫療中心門診區整修工程",
    meta: "歷史案 · 相似度 84%",
    score: 84,
    excerpt: "決標金額落在 780 萬至 930 萬區間，主要風險集中在夜間施工與感染控制規範。",
  },
  {
    id: "s3",
    kind: "知識庫",
    title: "醫療場域裝修資格檢核",
    meta: "內部規則 · 更新 2026-06-20",
    score: 78,
    excerpt: "醫療場域案件需優先確認施工時段、動線隔離、粉塵控制與實績描述一致性。",
  },
];

const libraryItems: LibraryItem[] = [
  {
    id: "thread-rail",
    tab: "components",
    name: "ThreadRail",
    description: "左側對話與任務脈絡，支援 score、scope、unread 與最近時間。",
    tags: ["navigation", "history", "assistant-ui"],
    icon: History,
    copy: "<ThreadRail threads={threads} activeId=\"north-hospital\" />",
  },
  {
    id: "answer-card",
    tab: "components",
    name: "AnswerCard",
    description: "助手回答容器，包含狀態、行動 chips、copy answer 與 evidence tray。",
    tags: ["message", "sources", "copy"],
    icon: MessageSquareText,
    copy: "<AnswerCard message={assistantMessage} sources={sources} />",
  },
  {
    id: "tool-timeline",
    tab: "components",
    name: "ToolTimeline",
    description: "顯示 retrieval、semantic search、compare、draft 的工具執行階段。",
    tags: ["tools", "progress", "grounding"],
    icon: Layers3,
    copy: "<ToolTimeline steps={toolSteps} compact />",
  },
  {
    id: "source-deck",
    tab: "components",
    name: "SourceDeck",
    description: "三欄 evidence cards，將標案、相似案、知識庫來源統一成可追溯證據。",
    tags: ["evidence", "cards", "source"],
    icon: FileText,
    copy: "<SourceDeck sources={sources} onOpen={openTender} />",
  },
  {
    id: "run-retrieval",
    tab: "functions",
    name: "runRetrievalPlan()",
    description: "依使用者問題產生 retrieval plan，先查 tender SQL，再查 semantic / similar。",
    tags: ["backend", "retrieval", "plan"],
    icon: Database,
    copy: "runRetrievalPlan({ prompt, focusTenderId, modes: ['sql', 'semantic', 'similar'] })",
  },
  {
    id: "rank-evidence",
    tab: "functions",
    name: "rankEvidence()",
    description: "把標案、知識庫與相似案依可信度、時間與相似度排序。",
    tags: ["ranking", "sources", "confidence"],
    icon: ShieldCheck,
    copy: "rankEvidence({ tender, semanticHits, similarHits, knowledgeHits })",
  },
  {
    id: "copy-summary",
    tab: "functions",
    name: "copyDecisionBrief()",
    description: "將 AI 回答轉成可貼到 Notion / LINE / 會議紀錄的摘要格式。",
    tags: ["copy", "brief", "workflow"],
    icon: Clipboard,
    copy: "copyDecisionBrief({ answer, sources, pendingChecks })",
  },
  {
    id: "prompt-fit",
    tab: "prompts",
    name: "承接適配度",
    description: "快速問出是否值得投、需要補什麼資料、最晚何時決策。",
    tags: ["fit", "risk", "decision"],
    icon: TrendingUp,
    copy: "這案適合 HQdesign 承接嗎？請用必看 / 可追 / 先略過回答，並列出要補的資格文件。",
  },
  {
    id: "prompt-compare",
    tab: "prompts",
    name: "相似案比較",
    description: "比較過去案與本案差異，找出預算、資格、時程、風險詞。",
    tags: ["compare", "similar", "history"],
    icon: GitCompareArrows,
    copy: "請找 5 件相似歷史案，比較預算、資格、截止日、履約期與風險，最後給投標優先級。",
  },
];

const quickActions = [
  { label: "先做判斷", icon: TrendingUp },
  { label: "比較相似案", icon: GitCompareArrows },
  { label: "整理資格", icon: ShieldCheck },
  { label: "複製摘要", icon: Clipboard },
];

export function AssistantStudioPage() {
  const [tab, setTab] = useState<LibraryTab>("components");
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return libraryItems.filter((item) => {
      if (item.tab !== tab) return false;
      if (!needle) return true;
      return [item.name, item.description, ...item.tags]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [query, tab]);

  const copyItem = async (item: LibraryItem) => {
    try {
      await navigator.clipboard?.writeText(item.copy);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(null), 1200);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1480px] space-y-5">
      <StudioHeader />

      <div className="grid min-h-[calc(100svh-11rem)] grid-cols-1 overflow-hidden rounded-lg border border-border bg-card shadow-[var(--elev-rest)] xl:grid-cols-[260px_minmax(0,1fr)_360px]">
        <ThreadRail />
        <main className="min-h-0 border-y border-border bg-white xl:border-x xl:border-y-0">
          <ConversationStage />
        </main>
        <LibraryPanel
          tab={tab}
          query={query}
          copiedId={copiedId}
          items={filteredItems}
          onTabChange={(value) => setTab(value as LibraryTab)}
          onQueryChange={setQuery}
          onCopy={copyItem}
        />
      </div>
    </div>
  );
}

function StudioHeader() {
  return (
    <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="signal">
            <Sparkles size={11} /> Assistant Studio
          </Badge>
          <Badge variant="outline">Mock data</Badge>
          <Badge variant="outline">不影響現有 /assistant</Badge>
        </div>
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
            標案 AI 助手完整元件設計方案
          </h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-muted">
            以 mock data 先驗證新的 assistant-ui 資訊架構：thread、對話、工具進度、證據來源、情境判斷，以及可搜尋／可複製的元件與功能庫。
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <Button key={action.label} variant="outline" size="sm">
              <Icon size={14} /> {action.label}
            </Button>
          );
        })}
      </div>
    </header>
  );
}

function ThreadRail() {
  return (
    <aside className="flex min-h-0 flex-col bg-canvas/45">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[12px] font-semibold text-foreground">
              對話任務
            </p>
            <p className="text-[11px] text-ink-dim">依決策情境整理</p>
          </div>
          <Button size="icon-sm" variant="ghost" title="更多">
            <MoreHorizontal size={15} />
          </Button>
        </div>
        <div className="mt-3">
          <Input
            name="assistant-studio-thread-search"
            aria-label="搜尋 mock threads"
            placeholder="搜尋對話、標案、功能"
            className="bg-white"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {threads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            className={cn(
              "w-full rounded-lg border p-3 text-left transition-all",
              thread.active
                ? "border-signal/35 bg-white shadow-[0_16px_30px_-24px_var(--signal-ring)]"
                : "border-transparent bg-transparent hover:border-border hover:bg-white",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
                  {thread.title}
                </p>
                <p className="mt-1 text-[11px] text-ink-dim">
                  {thread.scope} · {thread.time}
                </p>
              </div>
              {thread.unread && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-signal px-1 text-[10px] font-semibold text-white">
                  {thread.unread}
                </span>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-signal"
                  style={{ width: `${thread.score}%` }}
                />
              </div>
              <span className="tnum text-[11px] text-ink-muted">
                {thread.score}
              </span>
            </div>
          </button>
        ))}
      </div>

      <div className="border-t border-border p-3">
        <Card className="bg-white hover:translate-y-0">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-md bg-signal/10 text-signal">
                <Lightbulb size={15} />
              </span>
              <div>
                <p className="text-[12px] font-medium text-foreground">
                  設計假設
                </p>
                <p className="text-[11px] text-ink-dim">
                  助手不是聊天框，而是決策工作台。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </aside>
  );
}

function ConversationStage() {
  return (
    <section className="flex h-full min-h-[680px] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-signal text-white shadow-[0_10px_24px_-16px_var(--signal-ring)]">
            <Bot size={18} />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">
              北區醫院室內裝修案評估
            </h2>
            <p className="text-[12px] text-ink-muted">
              已帶入標案、相似案、知識庫與內部投標偏好
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">
            <CheckCircle2 size={11} /> grounding ready
          </Badge>
          <Button size="icon-sm" variant="ghost" title="設定">
            <Settings2 size={15} />
          </Button>
          <Button size="icon-sm" variant="ghost" title="開啟右側資訊">
            <PanelRight size={15} />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            <ToolTimeline />
            <SourceDeck />
          </div>
          <ComposerDock />
        </div>
        <ContextColumn />
      </div>
    </section>
  );
}

function MessageBubble({ message }: { message: StudioMessage }) {
  const isAssistant = message.role === "assistant";
  return (
    <article
      className={cn(
        "flex gap-3",
        message.role === "user" && "justify-end",
      )}
    >
      {isAssistant && (
        <AvatarShell icon={Bot} className="bg-signal/10 text-signal" />
      )}
      <div
        className={cn(
          "max-w-[760px] rounded-xl border px-4 py-3 shadow-[0_10px_28px_-26px_rgba(0,0,0,.45)]",
          isAssistant
            ? "border-border bg-card"
            : "border-signal/25 bg-signal text-white",
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span
            className={cn(
              "text-[11px] font-medium",
              isAssistant ? "text-ink-muted" : "text-white/75",
            )}
          >
            {message.author} · {message.time}
          </span>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] transition-colors",
              isAssistant
                ? "text-ink-dim hover:bg-accent hover:text-foreground"
                : "text-white/70 hover:bg-white/10 hover:text-white",
            )}
          >
            <Copy size={11} /> copy
          </button>
        </div>
        <p
          className={cn(
            "text-[13px] leading-relaxed",
            isAssistant ? "text-foreground/90" : "text-white",
          )}
        >
          {message.text}
        </p>
        {message.chips && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {message.chips.map((chip) => (
              <span
                key={chip}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  isAssistant
                    ? "bg-surface-2 text-ink-muted"
                    : "bg-white/14 text-white",
                )}
              >
                {chip}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function ToolTimeline() {
  return (
    <Card className="bg-white hover:translate-y-0">
      <CardHeader>
        <div>
          <CardTitle>工具執行狀態</CardTitle>
          <CardDescription>用清楚的階段感取代單一「思考中」</CardDescription>
        </div>
        <Badge variant="signal">
          <Loader2 size={11} className="animate-spin" /> running
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {toolSteps.map((step) => (
          <ToolStepCard key={step.id} step={step} />
        ))}
      </CardContent>
    </Card>
  );
}

function ToolStepCard({ step }: { step: ToolStep }) {
  const Icon = step.icon;
  const meta = {
    done: {
      label: "完成",
      cls: "bg-success/10 text-success",
      icon: Check,
    },
    running: {
      label: "執行中",
      cls: "bg-signal/10 text-signal",
      icon: Loader2,
    },
    queued: {
      label: "等待",
      cls: "bg-surface-2 text-ink-dim",
      icon: Clock3,
    },
  }[step.status];
  const StatusIcon = meta.icon;
  return (
    <div className="rounded-lg border border-border bg-canvas/35 p-3">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white text-ink-muted">
          <Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-medium text-foreground">
              {step.label}
            </p>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                meta.cls,
              )}
            >
              <StatusIcon
                size={10}
                className={step.status === "running" ? "animate-spin" : ""}
              />
              {meta.label}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-dim">
            {step.detail}
          </p>
        </div>
      </div>
    </div>
  );
}

function SourceDeck() {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {sources.map((source) => (
        <Card key={source.id} className="bg-white">
          <CardHeader className="items-start pb-2">
            <div className="min-w-0">
              <Badge variant="outline">{source.kind}</Badge>
              <CardTitle className="mt-2 line-clamp-2 text-[13px]">
                {source.title}
              </CardTitle>
              <CardDescription className="mt-1">{source.meta}</CardDescription>
            </div>
            <span className="tnum rounded-full bg-signal/10 px-2 py-1 text-[11px] font-semibold text-signal">
              {source.score}
            </span>
          </CardHeader>
          <CardContent>
            <p className="line-clamp-3 text-[12px] leading-relaxed text-ink-muted">
              {source.excerpt}
            </p>
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-signal hover:underline"
            >
              查看來源 <ArrowUpRight size={12} />
            </button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ComposerDock() {
  return (
    <div className="border-t border-border bg-white px-5 py-4">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {["改成會議摘要", "只看資格風險", "找更多相似案", "產出投標 checklist"].map(
          (label) => (
            <button
              key={label}
              type="button"
              className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:border-signal/35 hover:text-foreground"
            >
              {label}
            </button>
          ),
        )}
      </div>
      <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 focus-within:border-signal/45 focus-within:ring-2 focus-within:ring-signal/15">
        <Button size="icon" variant="ghost" title="附件">
          <Paperclip size={16} />
        </Button>
        <textarea
          name="assistant-studio-composer"
          rows={2}
          className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-ink-dim"
          placeholder="輸入下一步，例如：幫我把這案整理成週會可以討論的 5 點摘要"
        />
        <Button size="icon" variant="primary" title="送出">
          <SendHorizontal size={16} />
        </Button>
      </div>
    </div>
  );
}

function ContextColumn() {
  return (
    <aside className="hidden min-h-0 overflow-y-auto border-l border-border bg-canvas/35 p-4 lg:block">
      <div className="space-y-4">
        <MetricCard
          icon={TrendingUp}
          label="承接適配度"
          value="86"
          tone="signal"
          caption="高潛力，但需補資格文件"
        />
        <MetricCard
          icon={Clock3}
          label="決策時間"
          value="7d"
          tone="danger"
          caption="建議 48 小時內完成資格檢核"
        />
        <Card className="bg-white hover:translate-y-0">
          <CardHeader>
            <CardTitle>待確認</CardTitle>
            <Badge variant="outline">3 items</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              "近 5 年醫療場域或同級裝修實績",
              "夜間施工與感控規範是否能承接",
              "預算是否包含機電協調與臨時防護",
            ].map((item) => (
              <div key={item} className="flex items-start gap-2">
                <Info size={14} className="mt-0.5 shrink-0 text-signal" />
                <p className="text-[12px] leading-relaxed text-ink-muted">
                  {item}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </aside>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
  caption,
}: {
  icon: IconType;
  label: string;
  value: string;
  tone: Tone;
  caption: string;
}) {
  const toneClass: Record<Tone, string> = {
    signal: "text-signal bg-signal/10",
    success: "text-success bg-success/10",
    danger: "text-danger bg-danger/10",
    muted: "text-ink-muted bg-surface-2",
  };
  return (
    <Card className="bg-white hover:translate-y-0">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              "grid h-9 w-9 place-items-center rounded-lg",
              toneClass[tone],
            )}
          >
            <Icon size={16} />
          </span>
          <span className="tnum text-[28px] font-semibold leading-none text-foreground">
            {value}
          </span>
        </div>
        <p className="mt-3 text-[12px] font-medium text-foreground">{label}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
          {caption}
        </p>
      </CardContent>
    </Card>
  );
}

function LibraryPanel({
  tab,
  query,
  copiedId,
  items,
  onTabChange,
  onQueryChange,
  onCopy,
}: {
  tab: LibraryTab;
  query: string;
  copiedId: string | null;
  items: LibraryItem[];
  onTabChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onCopy: (item: LibraryItem) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col bg-card">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-2 text-ink-muted">
            <Library size={16} />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-foreground">
              元件與功能庫
            </p>
            <p className="text-[11px] text-ink-dim">搜尋後一鍵複製 mock spec</p>
          </div>
        </div>
        <div className="mt-3">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim"
            />
            <Input
              name="assistant-studio-library-search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="搜尋元件、功能、prompt"
              className="bg-white pl-8"
            />
          </div>
        </div>
        <Tabs
          value={tab}
          onValueChange={onTabChange}
          className="mt-3 w-full justify-between"
          aria-label="切換元件庫類型"
          items={[
            { value: "components", label: "元件", icon: <Code2 size={13} /> },
            { value: "functions", label: "功能", icon: <Brain size={13} /> },
            { value: "prompts", label: "提示", icon: <Sparkles size={13} /> },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {items.map((item) => (
          <LibraryCard
            key={item.id}
            item={item}
            copied={copiedId === item.id}
            onCopy={() => onCopy(item)}
          />
        ))}
        {items.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-[13px] font-medium text-foreground">
              沒有符合的項目
            </p>
            <p className="mt-1 text-[12px] text-ink-dim">
              換個關鍵字或切換分類。
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

function LibraryCard({
  item,
  copied,
  onCopy,
}: {
  item: LibraryItem;
  copied: boolean;
  onCopy: () => void;
}) {
  const Icon = item.icon;
  return (
    <Card className="bg-white hover:translate-y-0">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-muted">
            <Icon size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[12px] font-semibold text-foreground">
                {item.name}
              </p>
              <button
                type="button"
                onClick={onCopy}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  copied
                    ? "bg-success/10 text-success"
                    : "bg-surface-2 text-ink-muted hover:bg-accent hover:text-foreground",
                )}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? "已複製" : "複製"}
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
              {item.description}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-canvas px-1.5 py-0.5 text-[10px] text-ink-dim"
                >
                  {tag}
                </span>
              ))}
            </div>
            <div className="mt-3 rounded-md border border-border bg-canvas/50 px-2 py-1.5">
              <code className="line-clamp-2 font-mono text-[10px] leading-relaxed text-ink-muted">
                {item.copy}
              </code>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AvatarShell({
  icon: Icon,
  className,
}: {
  icon: IconType;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
        className,
      )}
    >
      <Icon size={16} />
    </span>
  );
}
