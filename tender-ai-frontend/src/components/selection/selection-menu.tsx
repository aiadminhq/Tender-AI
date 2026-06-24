// 全局選區工具列（Claude-markup 風格）：使用者用滑鼠框選任意段落文字後，提供兩種互動：
//   1) 主動：選取完成（mouseup）時，於選區上方浮出「橫向工具列」（icon＋窄寬度收成 icon-only）。
//   2) 被動：對著選取的文字按「右鍵」，於游標處彈出「直式選單」（label 全展開、更好讀）。
// 兩者動作相同：把選取詞「加入偏好／迴避／常點關鍵字」、做「相似搜尋」、或「傳送給 AI 提問」。
//
// 設計取向：
//  - 不劫持原生右鍵的一般行為；只有「有選取文字」且不在編輯區時，才攔截右鍵改彈我們的選單。
//  - 選取當下即把文字／矩形／游標／欄位脈絡快照進 state，按鈕點擊不依賴 live selection（避免失焦清空）。
//  - 在輸入框／textarea／contenteditable 內的選取不攔截（交還原生編輯／複製貼上行為）。
//  - 關鍵字加入只對「短選取」開放（≤24 字、無換行；term 欄位上限 128），長段落仍可相似搜尋／問 AI。
//  - 迴避＝負分關鍵字，是「負分一律由人手動給」的唯一合規人工路徑（系統不得自動產生負分）。
//  - 「傳送給 AI」會附上選取文字＋欄位／標案脈絡，經 assistant-bus 開窗送出（見 assistant-bus.ts）。
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useMatch, useNavigate } from "react-router-dom";
import {
  Heart,
  MessageCircle,
  Search,
  ShieldMinus,
  Sparkles,
} from "lucide-react";
import { useApp } from "@/store/app-context";
import { useAppData, type RuleList } from "@/store/app-data";
import { STRINGS } from "@/i18n/strings";
import { postKeywordOverride } from "@/lib/api";
import { requestAssistant } from "@/lib/assistant-bus";

type Variant = "bubble" | "context";

// 後端關鍵字類別（positive/negative/engaged）對應前端規則頁三清單（focus/avoid/hard）。
// 偏好→聚焦、迴避→避免、常點開＝關注亦併入聚焦（規則頁無 engaged 專屬清單）。
// 與 abandoned-roots.tsx 一致：postKeywordOverride 後再把詞反映進本地規則清單。
const RULE_LIST_FOR_KIND: Record<
  "positive" | "negative" | "engaged",
  RuleList
> = {
  positive: "focus",
  negative: "avoid",
  engaged: "focus",
};

interface Snapshot {
  text: string;
  variant: Variant;
  rect: { top: number; bottom: number; left: number; width: number };
  pointer: { x: number; y: number } | null; // 右鍵彈出時的游標座標
  fieldLabel: string | null;
}

const MAX_TERM = 24; // 關鍵字加入上限（短選取）；長段落僅相似搜尋／問 AI。

/** 選取錨點是否落在可編輯元素內（輸入框／textarea／contenteditable）。 */
function inEditable(node: Node | null): boolean {
  let el: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (el) {
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable)
      return true;
    el = el.parentElement;
  }
  return false;
}

/** 從選取節點往上找最近的「欄位標籤」脈絡：data-field → aria-label → th/dt → 最近標題。 */
function fieldLabelOf(node: Node | null): string | null {
  let el: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  for (let depth = 0; el && depth < 8; depth++, el = el.parentElement) {
    const dataField = el.getAttribute("data-field");
    if (dataField) return dataField;
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    if (el.tagName === "TH" || el.tagName === "DT") {
      const txt = el.textContent?.trim();
      if (txt) return txt;
    }
  }
  return null;
}

/** 讀取目前選取，回傳快照所需的文字／矩形／欄位脈絡；無有效選取則回 null。 */
function readSelection(): Omit<Snapshot, "variant" | "pointer"> | null {
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? "";
  if (!selection || selection.isCollapsed || !text) return null;
  if (inEditable(selection.anchorNode)) return null;
  const range = selection.getRangeAt(0);
  const r = range.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return {
    text,
    rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
    fieldLabel: fieldLabelOf(range.commonAncestorContainer),
  };
}

export function SelectionMenu() {
  const { t, lang } = useApp();
  const { addKeywords } = useAppData();
  const navigate = useNavigate();
  const tenderMatch = useMatch("/tenders/:id");
  const tenderId = tenderMatch?.params.id ?? null;

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [added, setAdded] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setSnap(null);
    setAdded(false);
  }, []);

  // 監聽：mouseup（主動工具列）、contextmenu（被動右鍵選單）、外點／Esc／捲動收起。
  useEffect(() => {
    function onMouseUp(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      // 讓瀏覽器先完成選取，再讀取。
      window.setTimeout(() => {
        const base = readSelection();
        if (!base) {
          setSnap(null);
          return;
        }
        setAdded(false);
        setSnap({ ...base, variant: "bubble", pointer: null });
      }, 0);
    }
    // 右鍵：僅在「有選取文字」且不在選單／編輯區時攔截，改彈我們的直式選單；
    // 否則放行原生選單（沒選取時的一般右鍵、輸入框內的複製貼上）。
    function onContextMenu(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      const base = readSelection();
      if (!base) return; // 無選取 → 不攔截，保留原生右鍵
      e.preventDefault();
      setAdded(false);
      setSnap({
        ...base,
        variant: "context",
        pointer: { x: e.clientX, y: e.clientY },
      });
    }
    // 在選單外按下（開始新選取）即收起。右鍵的 mousedown 也會先收舊選單，再由 contextmenu 重開。
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      setSnap(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSnap(null);
    }
    const onScroll = () => setSnap(null);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  // 量測選單尺寸後精算最終 left/top 並夾進視窗（避免溢出）。直接算座標、不靠 transform
  // 定位——transform 同時被進場動畫（zoom-in-95）使用，混用會讓實際位置與計算值對不上。
  // useLayoutEffect 於繪製前同步更新 → 不會閃爍。
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!snap || !el) {
      setPos(null);
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clamp = (v: number, max: number) => Math.min(Math.max(v, pad), max);

    if (snap.variant === "context" && snap.pointer) {
      // 右鍵選單：以游標為左上角；貼近右／下緣時往左／上翻。
      const { x, y } = snap.pointer;
      const left = x + w + pad <= vw ? x : Math.max(pad, x - w);
      const top = y + h + pad <= vh ? y : Math.max(pad, y - h);
      setPos({ left, top });
    } else {
      // 主動工具列：水平置中於選區、垂直放上方；上方空間不足時改放下方。
      const center = snap.rect.left + snap.rect.width / 2;
      const left = clamp(center - w / 2, vw - w - pad);
      const enoughAbove = snap.rect.top >= h + pad + 8;
      const top = enoughAbove ? snap.rect.top - 8 - h : snap.rect.bottom + 8;
      setPos({ left, top });
    }
  }, [snap]);

  if (!snap) return null;

  const isShort = snap.text.length <= MAX_TERM && !snap.text.includes("\n");
  const isContext = snap.variant === "context";

  async function addKeyword(kind: "positive" | "negative" | "engaged") {
    if (!snap) return;
    try {
      // 先寫後端（入庫 user_manual_keywords），成功後才反映進本地規則清單——
      // 讓框選的詞立即出現在「關鍵字規則頁」（/rules 讀 useAppData 的 focus/avoid/hard）。
      await postKeywordOverride(snap.text, kind, "add");
      addKeywords(RULE_LIST_FOR_KIND[kind], [snap.text]);
      setAdded(true);
      window.getSelection()?.removeAllRanges();
      window.setTimeout(close, 900);
    } catch {
      // 失敗不就地回滾畫面；維持選單開啟讓使用者重試。
    }
  }

  function similarSearch() {
    if (!snap) return;
    // 搜尋事件由目的頁（SearchPage 於 ?q= 自動執行時）落地，這裡不重複送。
    navigate(`/search?q=${encodeURIComponent(snap.text)}`);
    window.getSelection()?.removeAllRanges();
    close();
  }

  function askAi() {
    if (!snap) return;
    const ctx =
      (snap.fieldLabel ? STRINGS[lang].selMenuCtxField(snap.fieldLabel) : "") +
      (tenderId ? STRINGS[lang].selMenuCtxTender(tenderId) : "");
    const prompt = STRINGS[lang].selMenuAskPrompt(snap.text, ctx);
    requestAssistant(prompt);
    window.getSelection()?.removeAllRanges();
    close();
  }

  // 定位：以精算後的 left/top 直接固定（fixed 跟著視窗座標）。pos 未算出前先以 fallback 暫放，
  // useLayoutEffect 會在繪製前覆寫成正確值。
  const left = pos?.left ?? snap.pointer?.x ?? snap.rect.left;
  const top = pos?.top ?? snap.pointer?.y ?? snap.rect.top;

  const shell = isContext
    ? "flex flex-col gap-0.5 min-w-[176px] rounded-lg border border-border bg-popover p-1 shadow-[0_1px_2px_rgba(0,0,0,.06)]"
    : "flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-[0_1px_2px_rgba(0,0,0,.06)]";

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 animate-in fade-in zoom-in-95 duration-100"
      style={{ left, top }}
      // 避免點擊選單時清掉選取。
      onMouseDown={(e) => e.preventDefault()}
    >
      {added ? (
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-popover px-3 py-1.5 text-[12px] font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,.06)]">
          <Heart className="h-3.5 w-3.5 text-signal" aria-hidden />
          {t("selMenuAdded")}
        </div>
      ) : (
        <div className={shell}>
          {isShort && (
            <>
              <MenuButton
                icon={<Heart className="h-3.5 w-3.5" aria-hidden />}
                label={t("selMenuAddPos")}
                vertical={isContext}
                onClick={() => void addKeyword("positive")}
              />
              <MenuButton
                icon={<ShieldMinus className="h-3.5 w-3.5" aria-hidden />}
                label={t("selMenuAddNeg")}
                vertical={isContext}
                onClick={() => void addKeyword("negative")}
              />
              <MenuButton
                icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}
                label={t("selMenuAddEngaged")}
                vertical={isContext}
                onClick={() => void addKeyword("engaged")}
              />
              {isContext ? (
                <span className="my-0.5 h-px w-full bg-border" aria-hidden />
              ) : (
                <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
              )}
            </>
          )}
          <MenuButton
            icon={<Search className="h-3.5 w-3.5" aria-hidden />}
            label={t("selMenuSimilar")}
            vertical={isContext}
            onClick={similarSearch}
          />
          <MenuButton
            icon={<MessageCircle className="h-3.5 w-3.5" aria-hidden />}
            label={t("selMenuAskAi")}
            vertical={isContext}
            onClick={askAi}
          />
        </div>
      )}
    </div>
  );
}

function MenuButton({
  icon,
  label,
  vertical = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  // 直式（右鍵選單）：整列、靠左、label 永遠顯示。橫向工具列：窄寬度收成 icon-only。
  vertical?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={
        vertical
          ? "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-ink hover:bg-accent"
          : "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-ink hover:bg-accent"
      }
    >
      {icon}
      <span
        className={
          vertical ? "whitespace-nowrap" : "hidden whitespace-nowrap sm:inline"
        }
      >
        {label}
      </span>
    </button>
  );
}
