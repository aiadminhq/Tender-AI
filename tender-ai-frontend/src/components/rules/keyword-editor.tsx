import { useState, type FormEvent } from "react";
import { Plus, X, type LucideIcon } from "lucide-react";
import type { RuleList } from "@/store/app-data";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Accent = "signal" | "mid" | "danger";

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

export function KeywordEditor({
  list,
  title,
  typeTag,
  hint,
  words,
  icon: Icon,
  accent,
}: {
  list: RuleList;
  title: string;
  typeTag?: string;
  hint?: string;
  words: string[];
  icon: LucideIcon;
  accent: Accent;
}) {
  const { t } = useApp();
  const { addKeyword, removeKeyword } = useAppData();
  const [val, setVal] = useState("");

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!val.trim()) return;
    addKeyword(list, val.trim());
    setVal("");
  };

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <span
          className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-md",
            ICON_TONE[accent],
          )}
        >
          <Icon size={15} />
        </span>
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {typeTag && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              ICON_TONE[accent],
            )}
          >
            {typeTag}
          </span>
        )}
        <span className="tnum ml-auto text-[12px] text-ink-dim">
          {words.length}
        </span>
      </div>

      {hint && (
        <p className="mb-3 text-[11px] leading-relaxed text-ink-dim">{hint}</p>
      )}

      <div className="flex flex-1 flex-wrap content-start gap-1.5">
        {words.length === 0 ? (
          <span className="text-[12px] text-ink-dim">—</span>
        ) : (
          words.map((w) => (
            <span
              key={w}
              className={cn(
                "group inline-flex items-center gap-1 rounded-full border border-border bg-surface-1 py-1 pl-2.5 pr-1 text-[12px] text-ink transition-colors",
                CHIP_TONE[accent],
              )}
            >
              {w}
              <button
                type="button"
                onClick={() => removeKeyword(list, w)}
                aria-label={`移除「${w}」`}
                title={`移除「${w}」`}
                className="grid h-4 w-4 place-items-center rounded-full text-ink-dim transition-colors hover:bg-danger/15 hover:text-danger"
              >
                <X size={11} />
              </button>
            </span>
          ))
        )}
      </div>

      <form onSubmit={add} className="mt-3 flex gap-2">
        <Input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={t("addKeyword")}
          aria-label={t("addKeyword")}
        />
        <Button
          type="submit"
          variant="secondary"
          size="icon"
          disabled={!val.trim()}
          aria-label={t("addKeyword")}
        >
          <Plus size={15} />
        </Button>
      </form>
    </div>
  );
}
