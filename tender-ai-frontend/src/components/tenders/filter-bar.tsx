import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Link2,
  Save,
  X,
} from "lucide-react";
import type { Category, SortKey, SourceKey } from "@/types/domain";
import type { TextKey } from "@/i18n/strings";
import { useApp } from "@/store/app-context";
import { useAppData, SORT_DEFAULT_DIR } from "@/store/app-data";
import { SOURCES } from "@/data/sources";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { serializeFilter } from "@/lib/url-filter";

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

function MultiSelectDropdown<T extends string>({
  label,
  placeholder,
  options,
  selected,
  onToggle,
}: {
  label: string;
  placeholder: string;
  options: { key: T; label: string }[];
  selected: T[];
  onToggle: (key: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const selectedOptions = options.filter((option) => selected.includes(option.key));

  return (
    <div ref={rootRef} className="relative min-w-40 max-lg:w-full">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-9 w-full items-center gap-1.5 rounded-md border border-input bg-surface-1 px-2.5 py-1 text-left text-[12px] text-ink outline-none transition-colors hover:bg-accent focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/25"
      >
        <span className="flex min-w-0 flex-1 flex-wrap gap-1">
          {selectedOptions.length ? (
            selectedOptions.map((option) => (
              <span
                key={option.key}
                className="max-w-full truncate rounded-full bg-signal/12 px-2 py-0.5 font-medium text-signal"
              >
                {option.label}
              </span>
            ))
          ) : (
            <span className="text-ink-muted">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          size={15}
          className={cn("shrink-0 text-ink-dim transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          className="absolute left-0 z-40 mt-1 grid min-w-full overflow-hidden rounded-md border border-border bg-popover p-1 shadow-[var(--elev-float)]"
        >
          {options.map((option) => {
            const active = selected.includes(option.key);
            return (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => onToggle(option.key)}
                className={cn(
                  "flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] transition-colors",
                  active
                    ? "bg-signal/12 text-signal"
                    : "text-ink-muted hover:bg-accent hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded border",
                    active
                      ? "border-signal bg-signal text-white"
                      : "border-input bg-card text-transparent",
                  )}
                >
                  <Check size={11} strokeWidth={3} />
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function DateRangePicker({
  from,
  to,
  onChange,
  lang,
  clearLabel,
  fromLabel,
  toLabel,
}: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
  lang: "zh" | "en";
  clearLabel: string;
  fromLabel: string;
  toLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedFrom = parseDateKey(from);
  const selectedTo = parseDateKey(to);
  const [month, setMonth] = useState(() =>
    new Date((selectedFrom ?? selectedTo ?? new Date()).getFullYear(), (selectedFrom ?? selectedTo ?? new Date()).getMonth(), 1),
  );

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const monthLabel = new Intl.DateTimeFormat(
    lang === "zh" ? "zh-TW" : "en-US",
    { year: "numeric", month: "long" },
  ).format(month);
  const weekdays = lang === "zh" ? ["日", "一", "二", "三", "四", "五", "六"] : ["S", "M", "T", "W", "T", "F", "S"];
  const firstWeekday = month.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const fromKey = from ?? "";
  const toKey = to ?? "";
  const rangeLabel =
    from && to ? `${from} – ${to}` : from ? `${from} –` : to ? `– ${to}` : fromLabel;

  const selectDay = (value: string) => {
    if (!from || to) {
      onChange(value, null);
      return;
    }
    if (value < from) {
      onChange(value, null);
      return;
    }
    onChange(from, value);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`${fromLabel} ${toLabel}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-9 min-w-44 items-center gap-2 rounded-md border border-input bg-surface-1 px-2.5 text-[12px] text-ink outline-none transition-colors hover:bg-accent focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/25"
      >
        <CalendarDays size={15} className="shrink-0 text-signal" />
        <span className="tnum min-w-0 flex-1 truncate text-left">{rangeLabel}</span>
        <ChevronDown
          size={14}
          className={cn("shrink-0 text-ink-dim transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-72 rounded-md border border-border bg-popover p-3 shadow-[var(--elev-float)]">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label={lang === "zh" ? "上個月" : "Previous month"}
              onClick={() => setMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))}
              className="grid size-7 place-items-center rounded-sm text-ink-muted hover:bg-accent hover:text-ink"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-[12px] font-semibold text-ink">{monthLabel}</span>
            <button
              type="button"
              aria-label={lang === "zh" ? "下個月" : "Next month"}
              onClick={() => setMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))}
              className="grid size-7 place-items-center rounded-sm text-ink-muted hover:bg-accent hover:text-ink"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {weekdays.map((day, index) => (
              <span key={`${day}-${index}`} className="py-1 text-[10px] font-medium text-ink-dim">
                {day}
              </span>
            ))}
            {Array.from({ length: firstWeekday }).map((_, index) => (
              <span key={`pad-${index}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, index) => {
              const value = dateKey(new Date(month.getFullYear(), month.getMonth(), index + 1));
              const selected = value === fromKey || value === toKey;
              const inRange = Boolean(fromKey && toKey && value > fromKey && value < toKey);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectDay(value)}
                  className={cn(
                    "h-8 rounded-sm text-[12px] transition-colors",
                    selected && "bg-signal font-semibold text-white",
                    !selected && inRange && "bg-signal/12 text-signal",
                    !selected && !inRange && "text-ink-muted hover:bg-accent hover:text-ink",
                  )}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
          {(from || to) && (
            <div className="mt-2 flex justify-end border-t border-border pt-2">
              <Button variant="ghost" size="sm" onClick={() => onChange(null, null)}>
                {clearLabel}
              </Button>
            </div>
          )}
        </div>
      )}
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
  const [expanded, setExpanded] = useState(false);

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

  const activeCount = [
    !!filter.query,
    filter.sources.length > 0,
    filter.tiers.length > 0,
    filter.minBudget != null || filter.maxBudget != null,
    filter.minFeasibility != null || filter.maxFeasibility != null,
    filter.focusOnly,
    !filter.hideExcluded,
    filter.categories.length > 0,
    filter.orgKeyword.trim().length > 0,
    filter.deadlineFrom != null || filter.deadlineTo != null,
    filter.tagFilter.length > 0,
    filter.sort !== "score",
    filter.northOnly,
    filter.newToday,
  ].filter(Boolean).length;

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--elev-rest)]">
      {/* 窄視窗先收斂為摘要列；完整篩選按需展開，保留所有既有控制與鍵盤可及性。 */}
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 lg:hidden">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex min-w-0 items-center gap-2 rounded-lg text-left text-[13px] font-medium text-ink transition-colors hover:text-primary"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Filter size={15} />
          </span>
          <span>{t("filters")}</span>
          {activeCount > 0 && (
            <span className="rounded-full bg-signal/12 px-1.5 py-0.5 text-[10px] font-semibold text-signal">
              {activeCount}
            </span>
          )}
          <ChevronDown
            size={15}
            className={cn(
              "ml-0.5 text-ink-dim transition-transform duration-200",
              expanded && "rotate-180",
            )}
          />
        </button>
        {active && (
          <Button variant="ghost" size="sm" onClick={resetFilter}>
            <X size={14} />
            {t("clear")}
          </Button>
        )}
      </div>

      <div
        className={cn(
          "flex flex-wrap items-start gap-x-5 gap-y-3 px-3 py-3",
          !expanded && "max-lg:hidden",
          expanded && "border-t border-border lg:border-t-0",
        )}
      >
      {/* 資料源與採購類別：複選 dropdown，選取結果直接顯示為 tag。 */}
      <FilterGroup label={t("fgSources")} className="max-lg:w-full">
        <MultiSelectDropdown
          label={t("fgSources")}
          placeholder={t("allSources")}
          options={SOURCES.map((source) => ({
            key: source.key,
            label: source.shortName,
          }))}
          selected={filter.sources}
          onToggle={toggleSource}
        />
      </FilterGroup>

      <FilterGroup label={t("fgCategory")} className="max-lg:w-full">
        <MultiSelectDropdown
          label={t("fgCategory")}
          placeholder={t("tierAll")}
          options={CATEGORIES.map((category) => ({
            key: category.key,
            label: t(category.label),
          }))}
          selected={filter.categories}
          onToggle={toggleCategory}
        />
      </FilterGroup>

      {/* 截止日區間 */}
      <FilterGroup label={t("fgDeadline")} className="max-lg:w-full">
        <DateRangePicker
          from={filter.deadlineFrom}
          to={filter.deadlineTo}
          onChange={(deadlineFrom, deadlineTo) =>
            setFilter({ deadlineFrom, deadlineTo })
          }
          lang={lang}
          clearLabel={t("clear")}
          fromLabel={t("deadlineFrom")}
          toLabel={t("deadlineTo")}
        />
      </FilterGroup>

      {/* 標籤過濾 */}
      {allTags.length > 0 && (
        <FilterGroup label={t("fgTags")} className="max-lg:w-full">
          <div className="flex max-w-[18rem] flex-wrap items-center gap-1.5 overflow-y-auto lg:max-h-12 max-lg:max-w-none">
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

      {/* 右側：排序 + 收藏搜尋 + 分享／清除（手機窄寬時內部換行，避免橫向溢出） */}
      <div className="ml-auto flex w-full flex-wrap items-end justify-between gap-3 lg:w-auto lg:justify-end">
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
    </div>
  );
}
