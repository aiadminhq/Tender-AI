import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Eye,
  KanbanSquare,
  MapPin,
  Maximize2,
  Minimize2,
  RotateCcw,
  Star,
  Undo2,
  X,
} from "lucide-react";
import type { Tender } from "@/types/domain";
import { useApp } from "@/store/app-context";
import { useAppData } from "@/store/app-data";
import { STRINGS } from "@/i18n/strings";
import { trackSwipe } from "@/lib/swipe-signals";
import { sourceByKey } from "@/data/sources";
import { formatBudget, formatDate, daysLeft } from "@/lib/format";
import { TierBadge } from "@/components/ui/tier-badge";
import { FeasibilityMeter } from "@/components/ui/feasibility-meter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { Fact, CAT_KEY } from "@/components/tenders/detail-bits";
import { SwipeDecisionDialog } from "@/components/swipe/swipe-decision-dialog";
import { cn } from "@/lib/utils";

type Direction = "left" | "right" | "up";
// peek（看詳情）走導頁，不算滑動 commit；commit 僅處理三個方向。
type CommitAction = "accept" | "pass" | "save";

const SWIPE_THRESHOLD = 104; // 觸發 commit 的位移（px）
const MOVE_SLOP = 6; // 超過此位移視為拖曳而非點擊
const EXIT_MS = 320; // 飛出動畫時長，須與 onTransitionEnd 後援計時一致

// prefers-reduced-motion：關閉飛出/回彈動畫（拖曳跟手不算動畫，保留）。
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

// 卡片正面：沿用列表列（tender-row）的視覺語彙，放大為單張卡片版面。
// expanded＝就地展開（仍維持直條視窗，只是內容變多、可內部捲動）。
function SwipeCardFace({
  tender,
  expanded = false,
  onToggle,
  onViewFull,
}: {
  tender: Tender;
  expanded?: boolean;
  onToggle?: () => void;
  onViewFull?: () => void;
}) {
  const { t, lang } = useApp();
  const { feasOf, keywordHitsOf, isStarred } = useAppData();
  const source = sourceByKey(tender.source).shortName;
  const hits = keywordHitsOf(tender).slice(0, 6);
  const starred = isStarred(tender.id);

  // 比照 DeadlineCell：無效日期以「—」呈現，避免 Invalid Date 崩潰。
  const valid =
    Boolean(tender.deadline) &&
    !Number.isNaN(new Date(tender.deadline).getTime());
  const d = valid ? daysLeft(tender.deadline) : null;
  const tone =
    d == null || d < 0
      ? "text-ink-dim"
      : d <= 3
        ? "text-tier-low"
        : d <= 7
          ? "text-tier-mid"
          : "text-ink-muted";

  const toggleLabel =
    lang === "zh"
      ? expanded
        ? "收合標案摘要"
        : "展開標案摘要"
      : expanded
        ? "Collapse tender summary"
        : "Expand tender summary";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={toggleLabel}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onToggle?.();
        }
      }}
      className={cn(
        "group flex h-full cursor-pointer flex-col p-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/55",
        expanded && "overflow-y-auto",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TierBadge tier={tender.tier} lang={lang} />
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-dim">
            <FileText size={12} aria-hidden />
            <span className="tnum">{tender.caseNo ?? "—"}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {starred && (
            <Star
              size={16}
              className="fill-tier-mid text-tier-mid"
              aria-hidden
            />
          )}
          <span className="tnum text-[16px] font-semibold text-ink">
            {formatBudget(tender.budget, lang)}
          </span>
        </div>
      </div>

      <h2 className="mt-5 max-h-[5.25rem] overflow-hidden text-[20px] font-semibold leading-snug tracking-[-0.02em] text-ink">
        {tender.title}
      </h2>
      <div className="mt-3 flex items-start gap-2 text-[13px] text-ink-muted">
        <Building2 size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden />
        <p className="line-clamp-2">{tender.org}</p>
      </div>
      <p className="mt-1.5 pl-6 text-[11px] text-ink-dim">{source}</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {hits.length > 0 ? (
          hits.slice(0, 3).map((w) => (
            <Badge key={w} variant="signal">
              {w}
            </Badge>
          ))
        ) : (
          tender.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border">
        <div className="bg-card px-3 py-2.5">
          <div className="flex items-center gap-1 text-[10px] text-ink-dim">
            <CalendarDays size={12} aria-hidden />
            {t("publishedAt")}
          </div>
          <div className="tnum mt-1 text-[13px] font-medium text-ink">
            {formatDate(tender.publishedAt, lang)}
          </div>
        </div>
        <div className="bg-card px-3 py-2.5">
          <div className="flex items-center gap-1 text-[10px] text-ink-dim">
            <MapPin size={12} aria-hidden />
            {t("city")}
          </div>
          <div className="mt-1 truncate text-[13px] font-medium text-ink">
            {tender.city || "—"}
          </div>
        </div>
      </div>

      <div className={cn("space-y-2.5 pt-5", !expanded && "mt-auto")}>
        <FeasibilityMeter value={feasOf(tender).score} showLabel />
        <div className="flex items-center justify-between">
          <span className="tnum text-[12px] text-ink-muted">
            {valid ? formatDate(tender.deadline, lang) : "—"}
          </span>
          <span className={cn("tnum text-[12px]", tone)}>
            {d == null
              ? "—"
              : d < 0
                ? t("deadlinePassed")
                : `${d} ${t("daysLeft")}`}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[11px] text-ink-dim">
        <span>{expanded ? toggleLabel : lang === "zh" ? "點擊卡片查看完整摘要" : "Click card for full summary"}</span>
        <ChevronDown
          size={16}
          className={cn(
            "text-primary transition-transform duration-200 motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      </div>

      {/* 就地展開：仍維持直條視窗，只是補上更多事實／下一步／完整關鍵字，
          並提供「查看完整詳情」導往詳情頁。內容區隨卡片內部捲動。 */}
      {expanded && (
        <div className="mt-4 space-y-5 border-t border-border pt-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
            <Fact label={t("category")}>{t(CAT_KEY[tender.category])}</Fact>
            <Fact label={t("supplierCoverage")} num>
              {tender.supplierCoverage}
            </Fact>
          </dl>
          {(tender.caseNo || tender.tenderMethod || tender.city) && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              {tender.caseNo && (
                <Fact label={t("caseNo")} num>
                  {tender.caseNo}
                </Fact>
              )}
              {tender.tenderMethod && (
                <Fact label={t("tenderMethod")}>{tender.tenderMethod}</Fact>
              )}
              {tender.city && <Fact label={t("city")}>{tender.city}</Fact>}
            </dl>
          )}

          {tender.nextStep && (
            <div>
              <div className="mb-1.5 text-[11px] text-ink-dim">
                {t("colNext")}
              </div>
              <p className="text-[13px] leading-relaxed text-ink">
                {tender.nextStep}
              </p>
            </div>
          )}

          {tender.tags.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] text-ink-dim">
                {t("keywords")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tender.tags.map((tag) => (
                  <Badge key={tag} variant="signal">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {onViewFull && (
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={(e) => {
                e.stopPropagation();
                onViewFull();
              }}
            >
              <ExternalLink size={15} />
              <span>{t("viewFullDetail")}</span>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// 拖曳方向印章（LIKE/NOPE 風格），不可點、隨位移淡入。
function Stamp({ kind, opacity }: { kind: Direction; opacity: number }) {
  const { t } = useApp();
  const conf =
    kind === "right"
      ? {
          label: t("swipeInterested"),
          cls: "border-success/60 text-success",
          pos: "left-4 top-4 -rotate-12",
        }
      : kind === "left"
        ? {
            label: t("swipePass"),
            cls: "border-ink-dim/50 text-ink-muted",
            pos: "right-4 top-4 rotate-12",
          }
        : {
            label: t("swipeSave"),
            cls: "border-tier-mid/70 text-tier-mid",
            pos: "left-1/2 top-6 -translate-x-1/2",
          };
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-10 rounded-md border-2 px-3 py-1 text-[15px] font-bold uppercase tracking-wide",
        conf.cls,
        conf.pos,
      )}
      style={{ opacity }}
    >
      {conf.label}
    </div>
  );
}

// 44px 真按鈕，供無法/不便手勢操作者使用。
function ControlButton({
  onClick,
  disabled,
  label,
  variant,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  variant: "primary" | "secondary" | "ghost";
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={variant}
      size="icon"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="h-11 w-11 rounded-full"
    >
      {children}
    </Button>
  );
}

export function SwipePage() {
  const { t, lang } = useApp();
  const navigate = useNavigate();
  const reduce = usePrefersReducedMotion();
  const {
    filteredTenders,
    accept,
    toggleStar,
    isStarred,
    reclassify,
    tendersLoading,
    resetFilter,
  } = useAppData();
  // 註：左滑/✗＝淘汰(pass)。會把標案標記為 skipped 並接進「決策回顧」，但「永不刪除/隱藏」——
  // skipped 僅 /decisions 在讀，deck 與標案清單都不依它過濾，故卡片不會中途消失（可在回顧頁復原）。

  const deck = filteredTenders;
  const total = deck.length;

  // ?fullscreen=1：只在首次 render 讀一次（store 的 filter effect 之後會用
  // history.replaceState 改寫網址、清掉此參數），之後以本地 state 為準。
  const [searchParams] = useSearchParams();
  const [fullscreen, setFullscreen] = useState(
    () => searchParams.get("fullscreen") === "1",
  );

  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  const [dragging, setDragging] = useState(false);
  const [exit, setExit] = useState<{ transform: string } | null>(null);
  const [undoable, setUndoable] = useState<{
    action: CommitAction;
    tenderId: string;
    prevCursor: number;
  } | null>(null);
  // 判斷原因對話框（需求 B）：按下 ✓/⭐/✗ 先開此對話框收原因＋關鍵字，
  // 對話框解析（確認／一鍵略過）後才真正執行滑卡副作用與飛出動畫。
  const [pending, setPending] = useState<{
    action: CommitAction;
    dir: Direction;
    tenderId: string;
    title: string;
  } | null>(null);

  const hasCard = cursor < total;
  const ended = total > 0 && cursor >= total;
  const current = hasCard ? deck[cursor] : null;

  useEffect(() => {
    setExpanded(false);
  }, [current?.id]);

  // 給 stable callback 讀取最新值的鏡像 ref（避免閉包過期）。
  const cursorRef = useRef(cursor);
  const deckRef = useRef(deck);
  const exitRef = useRef(exit);
  const reduceRef = useRef(reduce);
  const undoableRef = useRef(undoable);
  const pendingRef = useRef(pending);
  cursorRef.current = cursor;
  deckRef.current = deck;
  exitRef.current = exit;
  reduceRef.current = reduce;
  undoableRef.current = undoable;
  pendingRef.current = pending;

  // 手勢決策用 ref（不觸發 render）。
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const deltaRef = useRef({ dx: 0, dy: 0 });
  const movedRef = useRef(false);
  const draggingRef = useRef(false);
  // window.setTimeout 在 DOM lib 回傳 number（避免 @types/node 的 Timeout 型別洩漏）。
  const exitTimerRef = useRef<number | null>(null);

  const advance = useCallback(() => {
    if (exitTimerRef.current != null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    setExit(null);
    setDrag({ dx: 0, dy: 0 });
    setDragging(false);
    draggingRef.current = false;
    movedRef.current = false;
    deltaRef.current = { dx: 0, dy: 0 };
    startRef.current = null;
    setCursor((c) => c + 1);
  }, []);

  // 按下 ✓/⭐/✗：不立即執行，先開判斷原因對話框（需求 B）。重複按或飛出中皆忽略。
  const commit = useCallback((action: CommitAction, dir: Direction) => {
    const tender = deckRef.current[cursorRef.current];
    if (!tender || exitRef.current || pendingRef.current) return;
    setPending({ action, dir, tenderId: tender.id, title: tender.title });
  }, []);

  // 對話框解析後才執行的副作用＋飛出動畫（行為事件已由對話框送出，這裡不再埋點）。
  // reason：對話框「確認並記錄」時帶回的淘汰理由（一鍵略過為 undefined）。
  const runDecisionEffect = useCallback(
    (action: CommitAction, dir: Direction, reason?: string) => {
      const tender = deckRef.current[cursorRef.current];
      if (!tender || exitRef.current) return;

      // 1) 副作用（依方向動 store）：
      //    accept→承接(建看板卡)；save→收藏；
      //    pass→標記 skipped 並接進決策回顧（附理由，可在 /decisions 復原），但不刪除/隱藏標案。
      if (action === "accept") accept(tender.id);
      else if (action === "save") toggleStar(tender.id);
      else if (action === "pass")
        reclassify(tender.id, "skipped", reason ? { reason } : undefined);

      // 2) 單步復原：僅 pass / save 可逆；accept 已建看板卡，不偽裝可復原。
      if (action === "pass" || action === "save") {
        setUndoable({
          action,
          tenderId: tender.id,
          prevCursor: cursorRef.current,
        });
      } else {
        setUndoable(null);
      }

      // 3) 視覺：reduced motion 直接前進；否則飛出後（transitionend／後援計時）前進。
      if (reduceRef.current) {
        advance();
        return;
      }
      const w = window.innerWidth;
      const h = window.innerHeight;
      const transform =
        dir === "right"
          ? `translate3d(${w * 1.15}px, 60px, 0) rotate(16deg)`
          : dir === "left"
            ? `translate3d(${-w * 1.15}px, 60px, 0) rotate(-16deg)`
            : `translate3d(0, ${-h * 1.1}px, 0)`;
      setExit({ transform });
      exitTimerRef.current = window.setTimeout(advance, EXIT_MS + 60);
    },
    [accept, toggleStar, reclassify, advance],
  );

  // 對話框收尾：先關閉，再執行原本的滑卡副作用（卡片此時仍在，可正常飛出）。
  // result：對話框「確認並記錄」帶回的淘汰理由（一鍵略過為 undefined）。
  const resolvePending = useCallback(
    (result?: { reason?: string }) => {
      const p = pendingRef.current;
      setPending(null);
      if (p) runDecisionEffect(p.action, p.dir, result?.reason);
    },
    [runDecisionEffect],
  );

  const peek = useCallback(() => {
    const tender = deckRef.current[cursorRef.current];
    if (!tender) return;
    trackSwipe("peek", tender.id);
    navigate(`/tenders/${tender.id}`);
  }, [navigate]);

  const undo = useCallback(() => {
    const u = undoableRef.current;
    if (!u) return;
    if (u.action === "save")
      toggleStar(u.tenderId); // 還原收藏
    else if (u.action === "pass") reclassify(u.tenderId, "none"); // 還原淘汰：移出 skipped
    setCursor(u.prevCursor);
    setUndoable(null);
  }, [toggleStar, reclassify]);

  const restart = useCallback(() => {
    setCursor(0);
    setUndoable(null);
  }, []);

  // 全域鍵盤：只訂閱一次，透過 ref 讀最新 handler，避免過期閉包。
  const kbdRef = useRef({
    hasCard,
    fullscreen,
    commit,
    peek,
    undo,
    exitFullscreen: () => setFullscreen(false),
  });
  kbdRef.current = {
    hasCard,
    fullscreen,
    commit,
    peek,
    undo,
    exitFullscreen: () => setFullscreen(false),
  };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = kbdRef.current;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // 判斷原因對話框開啟時，鍵盤交給對話框（Esc＝略過），頁面不攔截。
      if (pendingRef.current) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape" && s.fullscreen) {
        e.preventDefault();
        s.exitFullscreen();
        return;
      }
      if (!s.hasCard) return;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          s.commit("pass", "left");
          break;
        case "ArrowRight":
          e.preventDefault();
          s.commit("accept", "right");
          break;
        case "ArrowUp":
          e.preventDefault();
          s.commit("save", "up");
          break;
        case "Enter":
          e.preventDefault();
          s.peek();
          break;
        case "Backspace":
          e.preventDefault();
          s.undo();
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 卸載時清掉後援計時。
  useEffect(
    () => () => {
      if (exitTimerRef.current != null)
        window.clearTimeout(exitTimerRef.current);
    },
    [],
  );

  // ---- pointer handlers（只掛在最上層卡片）----
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (exitRef.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startRef.current = { x: e.clientX, y: e.clientY };
    deltaRef.current = { dx: 0, dy: 0 };
    movedRef.current = false;
    draggingRef.current = true;
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || !startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    deltaRef.current = { dx, dy };
    if (Math.abs(dx) > MOVE_SLOP || Math.abs(dy) > MOVE_SLOP)
      movedRef.current = true;
    setDrag({ dx, dy });
  }
  function finishDrag() {
    draggingRef.current = false;
    setDragging(false);
    const { dx, dy } = deltaRef.current;
    startRef.current = null;
    if (!movedRef.current) {
      // 沒位移＝交由卡片本身的 click 處理；中心點擊展開摘要，避免與滑動衝突。
      setDrag({ dx: 0, dy: 0 });
      return;
    }
    if (dy < -SWIPE_THRESHOLD && Math.abs(dy) >= Math.abs(dx))
      commit("save", "up");
    else if (dx > SWIPE_THRESHOLD) commit("accept", "right");
    else if (dx < -SWIPE_THRESHOLD) commit("pass", "left");
    else setDrag({ dx: 0, dy: 0 }); // 未過門檻 → 回彈
  }
  function onPointerUp() {
    if (draggingRef.current) finishDrag();
  }
  function onPointerCancel() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    startRef.current = null;
    setDrag({ dx: 0, dy: 0 });
  }

  // 最上層卡片樣式（飛出 / 拖曳跟手 / 回彈）。
  function topStyle(): React.CSSProperties {
    if (exit) {
      return {
        zIndex: 30,
        transform: exit.transform,
        opacity: 0,
        transition: `transform ${EXIT_MS}ms cubic-bezier(0.22,0.61,0.36,1), opacity ${EXIT_MS}ms ease-out`,
      };
    }
    if (dragging) {
      const rot = Math.max(-14, Math.min(14, drag.dx * 0.05));
      return {
        zIndex: 30,
        transform: `translate3d(${drag.dx}px, ${drag.dy}px, 0) rotate(${rot}deg)`,
        transition: "none",
      };
    }
    return {
      zIndex: 30,
      transform: "translate3d(0,0,0) rotate(0deg)",
      transition: reduce
        ? "none"
        : "transform 260ms cubic-bezier(0.22,1,0.36,1)",
    };
  }
  function backStyle(depth: number): React.CSSProperties {
    return {
      transform: `translateY(${depth * 12}px) scale(${1 - depth * 0.04})`,
      opacity: depth >= 2 ? 0 : 1,
      transition: reduce ? "none" : "transform 260ms ease, opacity 260ms ease",
      zIndex: 20 - depth,
    };
  }

  // 拖曳方向印章與其淡入程度。
  const stampDir: Direction | null = (() => {
    if (!dragging) return null;
    const { dx, dy } = drag;
    if (dy < -40 && Math.abs(dy) > Math.abs(dx)) return "up";
    if (dx > 40) return "right";
    if (dx < -40) return "left";
    return null;
  })();
  const stampOpacity = Math.min(
    1,
    Math.max(0, (Math.max(Math.abs(drag.dx), Math.abs(drag.dy)) - 24) / 90),
  );

  const curStarred = current ? isStarred(current.id) : false;
  const progressText =
    total > 0
      ? STRINGS[lang].swipeProgress(Math.min(cursor + 1, total), total)
      : "";

  // 牌組區（依狀態切換：載入骨架 / 無資料 / 末牌 / 牌堆）。
  let deckArea: React.ReactNode;
  if (total === 0) {
    deckArea = tendersLoading ? (
      <div className="relative mx-auto h-[440px] w-full max-w-[460px] sm:h-[480px]">
        <div className="absolute inset-0 animate-pulse rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
          <div className="space-y-3 p-5">
            <div className="h-5 w-16 rounded-full bg-surface-2" />
            <div className="mt-6 h-6 w-3/4 rounded bg-surface-2" />
            <div className="h-4 w-1/2 rounded bg-surface-2" />
          </div>
        </div>
      </div>
    ) : (
      <Card className="flex h-[440px] flex-col items-center justify-center gap-4 px-6 text-center shadow-[0_1px_2px_rgba(0,0,0,0.06)] sm:h-[480px]">
        <p className="text-[14px] text-ink-muted">{t("swipeNoData")}</p>
        <Button variant="secondary" size="sm" onClick={resetFilter}>
          {t("relax")}
        </Button>
      </Card>
    );
  } else if (ended) {
    deckArea = (
      <Card className="flex h-[440px] flex-col items-center justify-center gap-4 px-6 text-center shadow-[0_1px_2px_rgba(0,0,0,0.06)] sm:h-[480px]">
        <div className="text-[16px] font-semibold text-ink">
          {t("swipeEmptyTitle")}
        </div>
        <p className="max-w-xs text-[13px] text-ink-muted">
          {t("swipeEmptyHint")}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="secondary" size="sm" onClick={restart}>
            <RotateCcw size={15} />
            <span>{t("swipeRestart")}</span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate("/kanban")}
          >
            <KanbanSquare size={15} />
            <span>{t("swipeReviewBoard")}</span>
          </Button>
        </div>
      </Card>
    );
  } else {
    const cards: React.ReactNode[] = [];
    for (let i = cursor; i < Math.min(cursor + 3, total); i++) {
      const tender = deck[i];
      const depth = i - cursor;
      const isTop = depth === 0;
      cards.push(
        <div
          key={tender.id}
          aria-hidden={!isTop}
          className={cn(
            "absolute inset-0",
            isTop &&
              "cursor-grab touch-none select-none active:cursor-grabbing",
          )}
          style={isTop ? topStyle() : backStyle(depth)}
          onPointerDown={isTop ? onPointerDown : undefined}
          onPointerMove={isTop ? onPointerMove : undefined}
          onPointerUp={isTop ? onPointerUp : undefined}
          onPointerCancel={isTop ? onPointerCancel : undefined}
          onTransitionEnd={
            isTop
              ? (e) => {
                  if (e.propertyName === "transform" && exitRef.current)
                    advance();
                }
              : undefined
          }
        >
          <Card className="relative h-full w-full overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
            {isTop && stampDir && (
              <Stamp kind={stampDir} opacity={stampOpacity} />
            )}
            <SwipeCardFace
              tender={tender}
              expanded={isTop && expanded}
              onToggle={
                isTop
                  ? () => setExpanded((value) => !value)
                  : undefined
              }
              onViewFull={isTop ? peek : undefined}
            />
          </Card>
        </div>,
      );
    }
    deckArea = (
      <div className="relative mx-auto h-[440px] w-full max-w-[460px] sm:h-[480px]">
        {cards}
      </div>
    );
  }

  const controls = (
    <>
      <div className="mt-6 flex items-center justify-center gap-3">
        <ControlButton
          onClick={undo}
          disabled={!undoable}
          label={t("swipeUndo")}
          variant="ghost"
        >
          <Undo2 size={18} />
        </ControlButton>
        <ControlButton
          onClick={() => commit("pass", "left")}
          disabled={!hasCard}
          label={t("swipePass")}
          variant="secondary"
        >
          <X size={20} className="text-ink-muted" />
        </ControlButton>
        <ControlButton
          onClick={() => commit("save", "up")}
          disabled={!hasCard}
          label={t("swipeSave")}
          variant="secondary"
        >
          <Star
            size={18}
            className={cn(curStarred && "fill-tier-mid text-tier-mid")}
          />
        </ControlButton>
        <ControlButton
          onClick={() => commit("accept", "right")}
          disabled={!hasCard}
          label={t("swipeInterested")}
          variant="primary"
        >
          <Check size={20} />
        </ControlButton>
      </div>
      <div className="mt-3 flex justify-center">
        <Button variant="ghost" size="sm" onClick={peek} disabled={!hasCard}>
          <Eye size={15} />
          <span>{t("swipePeek")}</span>
        </Button>
      </div>
      {/* 鍵盤提示：細微、不喧賓奪主 */}
      <p className="mt-3 text-center text-[11px] text-ink-dim">
        ← {t("swipePass")} · → {t("swipeInterested")} · ↑ {t("swipeSave")} ·
        Enter {t("swipePeek")}
      </p>
    </>
  );

  const main = (
    <div className="w-full">
      {/* 進度條（scaleX，僅 transform 動畫）+ 文字 */}
      {total > 0 && (
        <div className="mx-auto mb-4 w-full max-w-[460px]">
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full origin-left bg-primary transition-transform duration-300"
              style={{
                transform: `scaleX(${Math.min(cursor, total) / total})`,
              }}
            />
          </div>
          <div className="tnum mt-2 text-center text-[12px] text-ink-dim">
            {progressText}
          </div>
        </div>
      )}

      {deckArea}
      {controls}

      {/* 螢幕報讀：宣告當前卡片與進度 */}
      <div className="sr-only" aria-live="polite">
        {current
          ? `${current.title}，${progressText}`
          : ended
            ? t("swipeEmptyTitle")
            : t("swipeNoData")}
      </div>

      {/* 判斷原因對話框（需求 B/C/D）：開啟時收原因＋可選關鍵字，解析後執行滑卡。 */}
      {pending && (
        <SwipeDecisionDialog
          action={pending.action}
          tenderId={pending.tenderId}
          title={pending.title}
          onResolved={resolvePending}
        />
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h1 className="text-[15px] font-semibold text-ink">
              {t("swipeTitle")}
            </h1>
            <p className="text-[12px] text-ink-dim">{t("swipeSub")}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("swipeExitFullscreen")}
            title={t("swipeExitFullscreen")}
            onClick={() => setFullscreen(false)}
          >
            <Minimize2 size={16} />
          </Button>
        </div>
        <div className="flex-1 overflow-auto px-4 py-6">
          <div className="mx-auto w-full max-w-[460px]">{main}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={t("swipeTitle")}
        subtitle={t("swipeSub")}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setFullscreen(true)}
          >
            <Maximize2 size={15} />
            <span>{t("swipeFullscreen")}</span>
          </Button>
        }
      />
      <div className="mx-auto w-full max-w-[460px]">{main}</div>
    </div>
  );
}
