import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  CircleSlash,
  Download,
  Eraser,
  Plus,
  Target,
  Upload,
  type LucideIcon,
} from "lucide-react";
import type { RuleList } from "@/store/app-data";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Accent = "signal" | "mid" | "danger";

const LISTS: {
  key: RuleList;
  labelKey: "focusKeywords" | "avoidKeywords" | "hardExclude";
  icon: LucideIcon;
  accent: Accent;
}[] = [
  { key: "focus", labelKey: "focusKeywords", icon: Target, accent: "signal" },
  { key: "avoid", labelKey: "avoidKeywords", icon: CircleSlash, accent: "mid" },
  { key: "hard", labelKey: "hardExclude", icon: Ban, accent: "danger" },
];

const TAB_TONE: Record<Accent, string> = {
  signal: "border-signal/45 bg-signal/10 text-signal",
  mid: "border-tier-mid/45 bg-tier-mid/10 text-tier-mid",
  danger: "border-danger/45 bg-danger/10 text-danger",
};

const ICON_TONE: Record<Accent, string> = {
  signal: "bg-signal/12 text-signal",
  mid: "bg-tier-mid/12 text-tier-mid",
  danger: "bg-danger/12 text-danger",
};

const CHIP_TONE: Record<Accent, string> = {
  signal: "hover:border-signal/40 hover:bg-signal/8",
  mid: "hover:border-tier-mid/40 hover:bg-tier-mid/8",
  danger: "hover:border-danger/40 hover:bg-danger/8",
};

// 把文字輸入解析成關鍵字陣列：依 換行/逗號/頓號 切分 → trim → 去空 → 去重。
function parseWords(raw: string): {
  words: string[];
  total: number;
  dup: number;
} {
  const tokens = raw
    .split(/[\n,，、]/)
    .map((w) => w.trim())
    .filter(Boolean);
  const words = [...new Set(tokens)];
  return { words, total: tokens.length, dup: tokens.length - words.length };
}

/**
 * 規則進階編輯工作區（純內容元件，呼叫端自行用 Dialog／頁面包裝）。
 * 無 props——直接讀寫 useAppData() 的三個關鍵字清單。
 */
export function RulesWorkspace() {
  const { t } = useApp();
  const {
    focusKeywords,
    avoidKeywords,
    hardExclude,
    addKeywords,
    moveKeyword,
    replaceKeywords,
    clearKeywords,
  } = useAppData();

  const wordsByList: Record<RuleList, string[]> = useMemo(
    () => ({ focus: focusKeywords, avoid: avoidKeywords, hard: hardExclude }),
    [focusKeywords, avoidKeywords, hardExclude],
  );

  const [active, setActive] = useState<RuleList>("focus");
  const [draft, setDraft] = useState("");

  const activeMeta = LISTS.find((l) => l.key === active)!;
  const activeWords = wordsByList[active];

  // 切換清單時把該清單載入 textarea（每行一詞）。
  useEffect(() => {
    setDraft(activeWords.join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const parsed = useMemo(() => parseWords(draft), [draft]);

  const applyReplace = () => replaceKeywords(active, parsed.words);
  const applyBatchAdd = () => {
    addKeywords(active, parsed.words);
  };
  const clear = () => {
    if (window.confirm(`${t("clearList")}：${t(activeMeta.labelKey)}？`)) {
      clearKeywords(active);
      setDraft("");
    }
  };

  // 匯出：三清單組成物件，下載成 JSON。
  const exportJSON = () => {
    const data = {
      focus: focusKeywords,
      avoid: avoidKeywords,
      hard: hardExclude,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tender-rules.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // 匯入：解析 JSON → 各清單 replaceKeywords。
  const importJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result)) as Partial<
          Record<RuleList, unknown>
        >;
        (["focus", "avoid", "hard"] as RuleList[]).forEach((key) => {
          const v = obj[key];
          if (Array.isArray(v)) {
            replaceKeywords(
              key,
              v.map((x) => String(x)),
            );
          }
        });
        if (Array.isArray(obj[active])) {
          setDraft((obj[active] as unknown[]).map((x) => String(x)).join("\n"));
        }
      } catch {
        window.alert("匯入失敗：JSON 格式不正確");
      }
    };
    reader.readAsText(file);
  };

  const moveTargets: {
    to: RuleList;
    labelKey: (typeof LISTS)[number]["labelKey"];
  }[] = [
    { to: "focus", labelKey: "focusKeywords" },
    { to: "avoid", labelKey: "avoidKeywords" },
    { to: "hard", labelKey: "hardExclude" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr]">
      {/* 左側：三清單切換 */}
      <div className="flex flex-col gap-2">
        {LISTS.map(({ key, labelKey, icon: Icon, accent }) => {
          const count = wordsByList[key].length;
          const isActive = key === active;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-[13px] transition-colors",
                isActive
                  ? TAB_TONE[accent]
                  : "border-border bg-card text-ink-muted hover:bg-accent",
              )}
            >
              <span
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-md",
                  ICON_TONE[accent],
                )}
              >
                <Icon size={13} />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {t(labelKey)}
              </span>
              <span className="tnum text-[12px] text-ink-dim">{count}</span>
            </button>
          );
        })}

        <div className="mt-1 flex flex-col gap-2 border-t border-border pt-3">
          <Button variant="outline" size="sm" onClick={exportJSON}>
            <Download size={14} />
            {t("exportRules")}
          </Button>
          <label className="contents">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={(e) => {
                (
                  e.currentTarget.nextElementSibling as HTMLInputElement | null
                )?.click();
              }}
            >
              <Upload size={14} />
              {t("importRules")}
            </Button>
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJSON(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {/* 右側：選定清單的大編輯區 */}
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "grid h-7 w-7 shrink-0 place-items-center rounded-md",
              ICON_TONE[activeMeta.accent],
            )}
          >
            <activeMeta.icon size={15} />
          </span>
          <h3 className="text-[14px] font-semibold text-ink">
            {t(activeMeta.labelKey)}
          </h3>
          <Badge variant="muted" className="tnum ml-auto">
            {activeWords.length}
          </Badge>
        </div>

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          placeholder="每行一個關鍵字，或以逗號／頓號分隔…"
          className="min-h-[220px] w-full resize-y rounded-md border border-input bg-surface-1 px-3 py-2 text-[13px] leading-relaxed text-foreground outline-none transition-colors placeholder:text-ink-dim focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/25"
        />

        {/* 即時去重提示 */}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-dim">
          <span>
            解析後 <span className="tnum text-ink">{parsed.words.length}</span>{" "}
            筆
          </span>
          {parsed.dup > 0 && (
            <span className="text-tier-mid">
              重複 <span className="tnum">{parsed.dup}</span> 筆（套用時去除）
            </span>
          )}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={applyReplace}>
            套用（取代）
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={applyBatchAdd}
            disabled={!parsed.words.length}
          >
            <Plus size={14} />
            {t("batchAdd")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={clear}
            disabled={!activeWords.length}
          >
            <Eraser size={14} />
            {t("clearList")}
          </Button>
        </div>

        {/* 逐詞搬移 */}
        {activeWords.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="mb-2 text-[11px] text-ink-dim">
              點關鍵字後的按鈕可搬移到其他清單
            </p>
            <div className="flex flex-col gap-1.5">
              {activeWords.map((w) => (
                <div
                  key={w}
                  className={cn(
                    "flex items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-[12px] text-ink transition-colors",
                    CHIP_TONE[activeMeta.accent],
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{w}</span>
                  <div className="flex shrink-0 gap-1">
                    {moveTargets
                      .filter((m) => m.to !== active)
                      .map((m) => (
                        <button
                          key={m.to}
                          type="button"
                          onClick={() => moveKeyword(active, m.to, w)}
                          className="rounded px-1.5 py-0.5 text-[11px] text-ink-dim transition-colors hover:bg-accent hover:text-foreground"
                          title={
                            m.to === "focus"
                              ? t("moveToFocus")
                              : m.to === "avoid"
                                ? t("moveToAvoid")
                                : t("moveToHard")
                          }
                        >
                          {m.to === "focus"
                            ? t("moveToFocus")
                            : m.to === "avoid"
                              ? t("moveToAvoid")
                              : t("moveToHard")}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
