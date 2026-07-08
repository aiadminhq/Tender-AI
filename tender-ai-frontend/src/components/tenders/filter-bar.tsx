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
import type { Category, SortKey, SourceKey } from "@/types/domain";
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

// 可行性：連續刻度 0–99（與 Tender.feasibility 一致）。上限刻意取 99 而非 100，
// 讓「拉滿」＝「不設上限」（feasibility=100 的標案仍通過，避免誤殺滿分案）。
const FEAS_MIN = 0;
const FEAS_MAX = 99;
const FEAS_STEP = 1;

// 一次顯示的標籤 chips 上限（超過則隱藏於可捲動區，避免 filter-bar 爆量）
const TAG_VISIBLE_MAX = 12;

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

// 依屬性分組的容器：小標籤在上、控制項在下，靠父層 gap 製造群組間隔。
function FilterGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-dim">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function clampBudget(value: number): number {
  return Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, value));
}

// 通用雙握把區間 slider：軌道視覺由 renderTrack 決定（預算＝直方圖、可行性＝細軌），
// 標題／範圍不進 slider；值僅呈現於左右下角落（見任務需求）。
function RangeSlider({
  min,
  max,
  step,
  lowValue,
  highValue,
  onChange,
  minLabel,
  maxLabel,
  minTitle,
  maxTitle,
  ariaValueText,
  renderTrack,
  trackClassName,
  className,
  minGap = 0,
}: {
  min: number;
  max: number;
  step: number;
  lowValue: number;
  highValue: number;
  onChange: (next: [number, number]) => void;
  minLabel: string;
  maxLabel: string;
  minTitle: string;
  maxTitle: string;
  ariaValueText?: (value: number) => string;
  renderTrack: (pct: { lowPercent: number; highPercent: number }) => ReactNode;
  trackClassName?: string;
  className?: string;
  minGap?: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"min" | "max" | null>(null);

  const span = max - min || 1;
  const toPercent = (value: number) => ((value - min) / span) * 100;
  const lowPercent = toPercent(lowValue);
  const highPercent = toPercent(highValue);

  const snap = useCallback(
    (value: number) => {
      const snapped = Math.round((value - min) / step) * step + min;
      return Math.min(max, Math.max(min, snapped));
    },
    [max, min, step],
  );

  // 允許 low === high（minGap=0 時可鎖單一值）；夾住 low ≤ high - minGap
  const commit = useCallback(
    (thumb: "min" | "max", raw: number) => {
      const value = snap(raw);
      if (thumb === "min") {
        onChange([Math.min(value, highValue - minGap), highValue]);
      } else {
        onChange([lowValue, Math.max(value, lowValue + minGap)]);
      }
    },
    [highValue, lowValue, minGap, onChange, snap],
  );

  const pointerToValue = useCallback(
    (clientX: number): number | null => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return null;
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return snap(min + pct * span);
    },
    [min, snap, span],
  );

  const moveThumb = useCallback(
    (thumb: "min" | "max", clientX: number) => {
      const value = pointerToValue(clientX);
      if (value != null) commit(thumb, value);
    },
    [commit, pointerToValue],
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
    const value = pointerToValue(event.clientX);
    if (value == null) return;
    // 區間外 → 動該側握把以擴張；區間內 → 動較近者。握把重疊時亦能正確分開。
    const thumb =
      value < lowValue
        ? "min"
        : value > highValue
          ? "max"
          : Math.abs(value - lowValue) <= Math.abs(value - highValue)
            ? "min"
            : "max";
    commit(thumb, value);
    setDragging(thumb);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    thumb: "min" | "max",
  ) => {
    let delta: number;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      delta = -step;
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      delta = step;
    } else if (event.key === "PageDown") {
      delta = -step * 5;
    } else if (event.key === "PageUp") {
      delta = step * 5;
    } else if (event.key === "Home") {
      event.preventDefault();
      commit(thumb, thumb === "min" ? min : lowValue + minGap);
      return;
    } else if (event.key === "End") {
      event.preventDefault();
      commit(thumb, thumb === "min" ? highValue - minGap : max);
      return;
    } else {
      return;
    }
    event.preventDefault();
    commit(thumb, (thumb === "min" ? lowValue : highValue) + delta);
  };

  return (
    <div className={cn("select-none", className)}>
      <div
        ref={trackRef}
        className={cn("relative touch-none", trackClassName)}
        onPointerDown={handleTrackPointerDown}
      >
        {renderTrack({ lowPercent, highPercent })}
        {(["min", "max"] as const).map((thumb) => {
          const isMin = thumb === "min";
          const value = isMin ? lowValue : highValue;
          const percent = isMin ? lowPercent : highPercent;
          return (
            <button
              key={thumb}
              type="button"
              role="slider"
              aria-label={isMin ? minTitle : maxTitle}
              aria-valuemin={isMin ? min : lowValue + minGap}
              aria-valuemax={isMin ? highValue - minGap : max}
              aria-valuenow={value}
              aria-valuetext={ariaValueText?.(value)}
              onPointerDown={(event) => {
                event.stopPropagation();
                setDragging(thumb);
              }}
              onKeyDown={(event) => handleKeyDown(event, thumb)}
              className={cn(
                "absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-card shadow-[var(--elev-rest)] transition-transform",
                "focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                // 握把重疊時上層者優先被指標命中；拖曳中者置頂
                isMin ? "z-10" : "z-20",
                dragging === thumb && "z-30 scale-110",
              )}
              style={{ left: `${percent}%` }}
            />
          );
        })}
      </div>

      {/* 值僅呈現於左右下角落（無上緣標題／範圍） */}
      <div className="mt-1 flex items-center justify-between">
        <span className="tnum text-[11px] font-medium text-ink-muted">
          {minLabel}
        </span>
        <span className="tnum text-[11px] font-medium text-ink-muted">
          {maxLabel}
        </span>
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

  const selectedMinFeas = Math.min(
    FEAS_MAX,
    Math.max(FEAS_MIN, filter.minFeasibility ?? FEAS_MIN),
  );
  const selectedMaxFeas = Math.min(
    FEAS_MAX,
    Math.max(selectedMinFeas, filter.maxFeasibility ?? FEAS_MAX),
  );

  const active =
    !!filter.query ||
    filter.sources.length > 0 ||
    filter.tiers.length > 0 ||
    filter.minBudget != null ||
    filter.maxBudget != null ||
    filter.minFeasibility != null ||
    filter.maxFeasibility != null ||
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
    <div className="flex flex-wrap items-start gap-x-5 gap-y-3 rounded-lg border border-border bg-card px-3 py-3">
      {/* 資料源 */}
      <FilterGroup label={t("fgSources")}>
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
      </FilterGroup>

      {/* 採購類別 */}
      <FilterGroup label={t("fgCategory")}>
        {CATEGORIES.map((cat) => (
          <Chip
            key={cat.key}
            active={filter.categories.includes(cat.key)}
            onClick={() => toggleCategory(cat.key)}
          >
            {t(cat.label)}
          </Chip>
        ))}
      </FilterGroup>

      {/* 可行性（0–99，雙握把；細軌、低高度） */}
      <FilterGroup label={t("feasibilityRange")}>
        <RangeSlider
          className="w-44 max-w-full"
          trackClassName="h-5"
          min={FEAS_MIN}
          max={FEAS_MAX}
          step={FEAS_STEP}
          lowValue={selectedMinFeas}
          highValue={selectedMaxFeas}
          minLabel={String(selectedMinFeas)}
          maxLabel={String(selectedMaxFeas)}
          minTitle={t("feasibilityMinimum")}
          maxTitle={t("feasibilityMaximum")}
          onChange={([lo, hi]) =>
            setFilter({
              minFeasibility: lo <= FEAS_MIN ? null : lo,
              maxFeasibility: hi >= FEAS_MAX ? null : hi,
            })
          }
          renderTrack={({ lowPercent, highPercent }) => (
            <>
              <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-hairline" />
              <div
                className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-signal"
                style={{
                  left: `${lowPercent}%`,
                  right: `${100 - highPercent}%`,
                }}
              />
            </>
          )}
        />
      </FilterGroup>

      {/* 預算區間（直方圖，雙握把；壓低高度） */}
      <FilterGroup label={t("budgetRange")}>
        <RangeSlider
          className="w-60 max-w-full"
          trackClassName="h-8"
          min={BUDGET_MIN}
          max={BUDGET_MAX}
          step={BUDGET_STEP}
          minGap={BUDGET_STEP}
          lowValue={sliderMinBudget}
          highValue={sliderMaxBudget}
          minLabel={formatBudget(sliderMinBudget, lang)}
          maxLabel={formatBudget(sliderMaxBudget, lang)}
          minTitle={t("budgetMinimum")}
          maxTitle={t("budgetMaximum")}
          onChange={([min, max]) =>
            setFilter({
              minBudget: min <= BUDGET_MIN ? null : min,
              maxBudget: max >= BUDGET_MAX ? null : max,
            })
          }
          renderTrack={({ lowPercent, highPercent }) => (
            <>
              <div className="absolute inset-x-0 bottom-1 top-0 flex items-end gap-px">
                {budgetBuckets.map((height, index) => {
                  const pct =
                    budgetBuckets.length <= 1
                      ? 0
                      : (index / (budgetBuckets.length - 1)) * 100;
                  const selected = pct >= lowPercent && pct <= highPercent;
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
                style={{
                  left: `${lowPercent}%`,
                  right: `${100 - highPercent}%`,
                }}
              />
            </>
          )}
        />
      </FilterGroup>

      {/* 截止日區間 */}
      <FilterGroup label={t("fgDeadline")}>
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
      </FilterGroup>

      {/* 機關關鍵字 */}
      <FilterGroup label={t("fgOrg")}>
        <Input
          type="text"
          value={filter.orgKeyword}
          onChange={(e) => setFilter({ orgKeyword: e.target.value })}
          placeholder={t("orgKeyword")}
          aria-label={t("orgKeyword")}
          className="h-9 w-32"
        />
      </FilterGroup>

      {/* 偏好開關 */}
      <FilterGroup label={t("fgPrefs")}>
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
      </FilterGroup>

      {/* 標籤過濾 */}
      {allTags.length > 0 && (
        <FilterGroup label={t("fgTags")}>
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
        </FilterGroup>
      )}

      {/* 右側：排序 + 收藏搜尋 + 分享／清除 */}
      <div className="ml-auto flex items-end gap-3">
        <FilterGroup label={t("sortBy")}>
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
        </FilterGroup>
        <div className="flex items-center gap-1">
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
    </div>
  );
}
