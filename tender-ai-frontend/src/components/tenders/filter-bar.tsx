import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Eye, EyeOff, Target, X, Link2, Save } from "lucide-react";
import type { Category, SortKey, SourceKey, Tier } from "@/types/domain";
import type { TextKey } from "@/i18n/strings";
import { useApp } from "@/store/app-context";
import { useAppData, SORT_DEFAULT_DIR } from "@/store/app-data";
import { SOURCES } from "@/data/sources";
import { formatBudget } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { serializeFilter } from "@/lib/url-filter";

const BUDGET_MIN = 1_000_000;
const BUDGET_MAX = 50_000_000;
const BUDGET_STEP = 1_000_000;
const BUDGET_BUCKETS = 42;

// 一次顯示的標籤 chips 上限（超過則隱藏於可捲動區，避免 filter-bar 爆量）
const TAG_VISIBLE_MAX = 12;

const TIERS: { key: Tier; label: TextKey }[] = [
  { key: "high", label: "tierHigh" },
  { key: "mid", label: "tierMid" },
  { key: "low", label: "tierLow" },
];

const CATEGORIES: { key: Category; label: TextKey }[] = [
  { key: "works", label: "catWorks" },
  { key: "goods", label: "catGoods" },
  { key: "services", label: "catServices" },
];

const SORTS: { key: SortKey; label: TextKey }[] = [
  { key: "score", label: "sortScore" },
  { key: "deadline", label: "sortDeadline" },
  { key: "budget", label: "sortBudget" },
  { key: "feasibility", label: "sortFeasibility" },
];

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
        active
          ? "border-signal/40 bg-signal/12 text-signal"
          : "border-border text-ink-muted hover:bg-accent hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="hidden h-5 w-px shrink-0 bg-hairline lg:block" />;
}

function clampBudget(value: number): number {
  return Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, value));
}

function valueToPercent(value: number): number {
  return ((value - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)) * 100;
}

function pointerToBudget(clientX: number, rect: DOMRect): number {
  const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const raw = BUDGET_MIN + pct * (BUDGET_MAX - BUDGET_MIN);
  return clampBudget(Math.round(raw / BUDGET_STEP) * BUDGET_STEP);
}

function BudgetRangeSlider({
  minValue,
  maxValue,
  buckets,
  onChange,
  minLabel,
  maxLabel,
  minTitle,
  maxTitle,
  rangeLabel,
}: {
  minValue: number;
  maxValue: number;
  buckets: number[];
  onChange: (next: [number, number]) => void;
  minLabel: string;
  maxLabel: string;
  minTitle: string;
  maxTitle: string;
  rangeLabel: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"min" | "max" | null>(null);

  const minPercent = valueToPercent(minValue);
  const maxPercent = valueToPercent(maxValue);

  const commit = useCallback(
    (thumb: "min" | "max", nextValue: number) => {
      const clamped = clampBudget(nextValue);
      if (thumb === "min") {
        onChange([Math.min(clamped, maxValue - BUDGET_STEP), maxValue]);
      } else {
        onChange([minValue, Math.max(clamped, minValue + BUDGET_STEP)]);
      }
    },
    [maxValue, minValue, onChange],
  );

  const moveThumb = useCallback(
    (thumb: "min" | "max", clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      commit(thumb, pointerToBudget(clientX, rect));
    },
    [commit],
  );

  useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (event: PointerEvent) =>
      moveThumb(dragging, event.clientX);
    const onPointerUp = () => setDragging(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dragging, moveThumb]);

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = pointerToBudget(event.clientX, rect);
    const thumb =
      Math.abs(next - minValue) <= Math.abs(next - maxValue) ? "min" : "max";
    commit(thumb, next);
    setDragging(thumb);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    thumb: "min" | "max",
  ) => {
    let delta: number;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      delta = -BUDGET_STEP;
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      delta = BUDGET_STEP;
    } else if (event.key === "PageDown") {
      delta = -BUDGET_STEP * 5;
    } else if (event.key === "PageUp") {
      delta = BUDGET_STEP * 5;
    } else if (event.key === "Home") {
      event.preventDefault();
      commit(thumb, thumb === "min" ? BUDGET_MIN : minValue + BUDGET_STEP);
      return;
    } else if (event.key === "End") {
      event.preventDefault();
      commit(thumb, thumb === "min" ? maxValue - BUDGET_STEP : BUDGET_MAX);
      return;
    } else {
      return;
    }
    event.preventDefault();
    commit(thumb, (thumb === "min" ? minValue : maxValue) + delta);
  };

  return (
    <div className="w-[19rem] max-w-full space-y-2 rounded-md bg-surface-2/60 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="whitespace-nowrap text-[12px] text-ink-muted">
          {rangeLabel}
        </span>
        <span className="tnum truncate text-[12px] font-medium text-ink">
          {minLabel} – {maxLabel}
        </span>
      </div>

      <div
        ref={trackRef}
        className="relative h-10 touch-none select-none"
        onPointerDown={handleTrackPointerDown}
      >
        <div className="absolute inset-x-0 bottom-1 top-0 flex items-end gap-px">
          {buckets.map((height, index) => {
            const pct = buckets.length <= 1 ? 0 : (index / (buckets.length - 1)) * 100;
            const selected = pct >= minPercent && pct <= maxPercent;
            return (
              <span
                key={index}
                className={cn(
                  "min-w-0 flex-1 rounded-t-sm transition-colors",
                  selected ? "bg-ink" : "bg-hairline",
                )}
                style={{ height: `${Math.max(12, height * 100)}%` }}
              />
            );
          })}
        </div>
        <div
          className="absolute bottom-0 top-0 border-l border-r border-signal/40"
          style={{ left: `${minPercent}%`, right: `${100 - maxPercent}%` }}
        />
        {(["min", "max"] as const).map((thumb) => {
          const isMin = thumb === "min";
          const value = isMin ? minValue : maxValue;
          const percent = isMin ? minPercent : maxPercent;
          return (
            <button
              key={thumb}
              type="button"
              role="slider"
              aria-label={isMin ? minTitle : maxTitle}
              aria-valuemin={isMin ? BUDGET_MIN : minValue + BUDGET_STEP}
              aria-valuemax={isMin ? maxValue - BUDGET_STEP : BUDGET_MAX}
              aria-valuenow={value}
              onPointerDown={(event) => {
                event.stopPropagation();
                setDragging(thumb);
              }}
              onKeyDown={(event) => handleKeyDown(event, thumb)}
              className={cn(
                "absolute top-1/2 z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-card shadow-[var(--elev-rest)] transition-transform",
                "focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                dragging === thumb && "scale-110",
              )}
              style={{ left: `${percent}%` }}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-border bg-card px-2 py-1.5">
          <p className="text-[10px] text-ink-dim">{minTitle}</p>
          <p className="tnum text-[12px] font-semibold text-ink">{minLabel}</p>
        </div>
        <div className="rounded-md border border-border bg-card px-2 py-1.5">
          <p className="text-[10px] text-ink-dim">{maxTitle}</p>
          <p className="tnum text-[12px] font-semibold text-ink">{maxLabel}</p>
        </div>
      </div>
    </div>
  );
}

export function FilterBar() {
  const { t, lang } = useApp();
  const {
    filter,
    setFilter,
    resetFilter,
    tenders,
    savedSearches,
    saveCurrentSearch,
    applySavedSearch,
  } = useAppData();

  const toggleSource = (k: SourceKey) =>
    setFilter({
      sources: filter.sources.includes(k)
        ? filter.sources.filter((x) => x !== k)
        : [...filter.sources, k],
    });

  const toggleTier = (k: Tier) =>
    setFilter({
      tiers: filter.tiers.includes(k)
        ? filter.tiers.filter((x) => x !== k)
        : [...filter.tiers, k],
    });

  const toggleCategory = (k: Category) =>
    setFilter({
      categories: filter.categories.includes(k)
        ? filter.categories.filter((x) => x !== k)
        : [...filter.categories, k],
    });

  const toggleTag = (tag: string) =>
    setFilter({
      tagFilter: filter.tagFilter.includes(tag)
        ? filter.tagFilter.filter((x) => x !== tag)
        : [...filter.tagFilter, tag],
    });

  // 全體 tenders 的 tags 去重（保留出現順序）
  const allTags = useMemo(() => {
    const seen = new Set<string>();
    for (const tn of tenders) {
      for (const tag of tn.tags) seen.add(tag);
    }
    return [...seen];
  }, [tenders]);

  const budgetBuckets = useMemo(() => {
    const buckets = Array.from({ length: BUDGET_BUCKETS }, () => 0);
    for (const tender of tenders) {
      const budget = clampBudget(tender.budget);
      const index = Math.min(
        BUDGET_BUCKETS - 1,
        Math.max(
          0,
          Math.floor(
            ((budget - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)) *
              BUDGET_BUCKETS,
          ),
        ),
      );
      buckets[index] += 1;
    }
    const max = Math.max(...buckets, 1);
    return buckets.map((count) => count / max);
  }, [tenders]);

  const selectedMinBudget = clampBudget(filter.minBudget ?? BUDGET_MIN);
  const selectedMaxBudget = clampBudget(filter.maxBudget ?? BUDGET_MAX);
  const sliderMinBudget = clampBudget(
    Math.min(selectedMinBudget, selectedMaxBudget - BUDGET_STEP),
  );
  const sliderMaxBudget = clampBudget(
    Math.max(selectedMaxBudget, sliderMinBudget + BUDGET_STEP),
  );

  const active =
    !!filter.query ||
    filter.sources.length > 0 ||
    filter.tiers.length > 0 ||
    filter.minBudget != null ||
    filter.maxBudget != null ||
    filter.focusOnly ||
    !filter.hideExcluded ||
    filter.categories.length > 0 ||
    filter.orgKeyword.trim().length > 0 ||
    filter.deadlineFrom != null ||
    filter.deadlineTo != null ||
    filter.tagFilter.length > 0 ||
    filter.sort !== "score" ||
    filter.northOnly ||
    filter.newToday;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-3 py-2.5">
      {/* 資料源 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {SOURCES.map((s) => (
          <Chip
            key={s.key}
            active={filter.sources.includes(s.key)}
            onClick={() => toggleSource(s.key)}
            title={s.name}
          >
            {s.shortName}
          </Chip>
        ))}
      </div>

      <Divider />

      {/* 分級 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TIERS.map((tier) => (
          <Chip
            key={tier.key}
            active={filter.tiers.includes(tier.key)}
            onClick={() => toggleTier(tier.key)}
          >
            {t(tier.label)}
          </Chip>
        ))}
      </div>

      <Divider />

      {/* 採購類別 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {CATEGORIES.map((cat) => (
          <Chip
            key={cat.key}
            active={filter.categories.includes(cat.key)}
            onClick={() => toggleCategory(cat.key)}
          >
            {t(cat.label)}
          </Chip>
        ))}
      </div>

      <Divider />

      {/* 偏好開關 */}
      <Chip
        active={filter.focusOnly}
        onClick={() => setFilter({ focusOnly: !filter.focusOnly })}
      >
        <Target size={13} />
        {t("focusOnly")}
      </Chip>
      <Chip
        active={!filter.hideExcluded}
        onClick={() => setFilter({ hideExcluded: !filter.hideExcluded })}
        title={t("hideExcluded")}
      >
        {filter.hideExcluded ? <EyeOff size={13} /> : <Eye size={13} />}
        {t("hideExcluded")}
      </Chip>
      <Chip
        active={filter.northOnly}
        onClick={() => setFilter({ northOnly: !filter.northOnly })}
      >
        {t("northOnly")}
      </Chip>
      <Chip
        active={filter.newToday}
        onClick={() => setFilter({ newToday: !filter.newToday })}
      >
        {t("newToday")}
      </Chip>

      <Divider />

      {/* 預算區間 */}
      <BudgetRangeSlider
        minValue={sliderMinBudget}
        maxValue={sliderMaxBudget}
        buckets={budgetBuckets}
        minLabel={formatBudget(sliderMinBudget, lang)}
        maxLabel={formatBudget(sliderMaxBudget, lang)}
        minTitle={t("budgetMinimum")}
        maxTitle={t("budgetMaximum")}
        rangeLabel={t("budgetRange")}
        onChange={([min, max]) =>
          setFilter({
            minBudget: min <= BUDGET_MIN ? null : min,
            maxBudget: max >= BUDGET_MAX ? null : max,
          })
        }
      />

      <Divider />

      {/* 機關關鍵字 */}
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap text-[12px] text-ink-muted">
          {t("orgKeyword")}
        </span>
        <Input
          type="text"
          value={filter.orgKeyword}
          onChange={(e) => setFilter({ orgKeyword: e.target.value })}
          placeholder={t("orgKeyword")}
          aria-label={t("orgKeyword")}
          className="h-9 w-32"
        />
      </div>

      <Divider />

      {/* 截止日區間 */}
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={filter.deadlineFrom ?? ""}
          onChange={(e) => setFilter({ deadlineFrom: e.target.value || null })}
          aria-label={t("deadlineFrom")}
          title={t("deadlineFrom")}
          className="h-9 cursor-pointer rounded-md border border-input bg-surface-1 px-2 text-[12px] text-ink outline-none transition-colors focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/25"
        />
        <span className="text-[12px] text-ink-muted">–</span>
        <input
          type="date"
          value={filter.deadlineTo ?? ""}
          onChange={(e) => setFilter({ deadlineTo: e.target.value || null })}
          aria-label={t("deadlineTo")}
          title={t("deadlineTo")}
          className="h-9 cursor-pointer rounded-md border border-input bg-surface-1 px-2 text-[12px] text-ink outline-none transition-colors focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/25"
        />
      </div>

      {/* 標籤過濾 */}
      {allTags.length > 0 && (
        <>
          <Divider />
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-[12px] text-ink-muted">
              {t("tagFilter")}
            </span>
            <div className="flex max-w-[18rem] flex-wrap items-center gap-1.5 overflow-y-auto lg:max-h-12">
              {allTags.slice(0, TAG_VISIBLE_MAX).map((tag) => (
                <Chip
                  key={tag}
                  active={filter.tagFilter.includes(tag)}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </Chip>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 右側：排序 + 清除 */}
      <div className="ml-auto flex items-center gap-2">
        <span className="whitespace-nowrap text-[12px] text-ink-muted">
          {t("sortBy")}
        </span>
        <select
          value={filter.sort}
          onChange={(e) => {
            const key = e.target.value as SortKey;
            setFilter({ sort: key, sortDir: SORT_DEFAULT_DIR[key] });
          }}
          aria-label={t("sortBy")}
          className="h-9 cursor-pointer rounded-md border border-input bg-surface-1 px-2.5 text-[12px] text-ink outline-none transition-colors focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/25"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {t(s.label)}
            </option>
          ))}
        </select>
        {savedSearches.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id) applySavedSearch(id);
            }}
            aria-label={t("savedSearches")}
            className="h-9 cursor-pointer rounded-md border border-input bg-surface-1 px-2.5 text-[12px] text-ink outline-none transition-colors focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/25"
          >
            <option value="">{t("savedSearches")}</option>
            {savedSearches.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <Button
          variant="ghost"
          size="sm"
          title={t("saveSearch")}
          onClick={() => {
            const name = window.prompt(t("saveSearchPrompt"));
            if (name) saveCurrentSearch(name);
          }}
        >
          <Save size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title={t("shareFilter")}
          onClick={() => {
            const qs = serializeFilter(filter);
            const url = `${window.location.origin}${window.location.pathname}${qs ? "?" + qs : ""}`;
            void navigator.clipboard?.writeText(url).catch(() => {});
          }}
        >
          <Link2 size={14} />
        </Button>
        {active && (
          <Button variant="ghost" size="sm" onClick={resetFilter}>
            <X size={14} />
            {t("clear")}
          </Button>
        )}
      </div>
    </div>
  );
}
