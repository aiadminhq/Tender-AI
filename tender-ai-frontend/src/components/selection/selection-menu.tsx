// 全局選區浮動選單（Claude-markup 風格）：使用者用滑鼠框選任意段落文字後，於選區上方
// 浮出小工具列，可把選取詞「加入偏好／迴避／常點關鍵字」、做「相似搜尋」、或「傳送給 AI 提問」。
//
// 設計取向：
//  - 不劫持原生右鍵；改在「選取完成」（mouseup）時浮出，類似 Claude design 的圈選 markup。
//  - 選取當下即把文字／矩形／欄位脈絡快照進 state，按鈕點擊不依賴 live selection（避免點擊失焦清空）。
//  - 在輸入框／textarea／contenteditable 內的選取不攔截（交還原生編輯行為）。
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
import { STRINGS } from "@/i18n/strings";
import { postKeywordOverride } from "@/lib/api";
import { requestAssistant } from "@/lib/assistant-bus";

interface Snapshot {
  text: string;
  rect: { top: number; bottom: number; left: number; width: number };
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

export function SelectionMenu() {
  const { t, lang } = useApp();
  const navigate = useNavigate();
  const tenderMatch = useMatch("/tenders/:id");
  const tenderId = tenderMatch?.params.id ?? null;

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [added, setAdded] = useState(false);
  const [clampedLeft, setClampedLeft] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setSnap(null);
    setAdded(false);
  }, []);

  // 選取完成：快照文字／矩形／欄位脈絡。點到選單本身則不重算。
  useEffect(() => {
    function onMouseUp(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      // 讓瀏覽器先完成選取，再讀取。
      window.setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim() ?? "";
        if (!selection || selection.isCollapsed || !text) {
          setSnap(null);
          return;
        }
        const anchor = selection.anchorNode;
        if (inEditable(anchor)) {
          setSnap(null);
          return;
        }
        const range = selection.getRangeAt(0);
        const r = range.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) {
          setSnap(null);
          return;
        }
        setAdded(false);
        setSnap({
          text,
          rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
          fieldLabel: fieldLabelOf(range.commonAncestorContainer),
        });
      }, 0);
    }
    // 在選單外按下（開始新選取）即收起。
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      setSnap(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSnap(null);
    }
    const onScroll = () => setSnap(null);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  // 量測選單寬度後直接算出「最終左緣」並夾進視窗（避免貼近邊緣時溢出）。不靠 transform
  // 做水平置中——transform 同時被進場動畫使用，混用會讓實際位置與計算值對不上。
  // useLayoutEffect 於繪製前同步更新 → 不會閃爍。
  useLayoutEffect(() => {
    if (!snap || !menuRef.current) {
      setClampedLeft(null);
      return;
    }
    const w = menuRef.current.offsetWidth;
    const pad = 8;
    const center = snap.rect.left + snap.rect.width / 2;
    setClampedLeft(
      Math.min(Math.max(center - w / 2, pad), window.innerWidth - w - pad),
    );
  }, [snap]);

  if (!snap) return null;

  const isShort = snap.text.length <= MAX_TERM && !snap.text.includes("\n");

  async function addKeyword(kind: "positive" | "negative" | "engaged") {
    if (!snap) return;
    try {
      await postKeywordOverride(snap.text, kind, "add");
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

  // 定位：選區上方，貼近視窗上緣時改放下方。固定定位（fixed）跟著視窗座標。
  // 水平用已夾取的最終左緣直接定位；transform 只負責垂直收尾（放上方時上移自身高度）。
  const left = clampedLeft ?? snap.rect.left;
  const placeBelow = snap.rect.top < 64;
  const style: React.CSSProperties = placeBelow
    ? { left, top: snap.rect.bottom + 8 }
    : { left, top: snap.rect.top - 8, transform: "translateY(-100%)" };

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 animate-in fade-in zoom-in-95 duration-100"
      style={style}
      // 避免點擊選單時清掉選取。
      onMouseDown={(e) => e.preventDefault()}
    >
      {added ? (
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-popover px-3 py-1.5 text-[12px] font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,.06)]">
          <Heart className="h-3.5 w-3.5 text-signal" aria-hidden />
          {t("selMenuAdded")}
        </div>
      ) : (
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-[0_1px_2px_rgba(0,0,0,.06)]">
          {isShort && (
            <>
              <MenuButton
                icon={<Heart className="h-3.5 w-3.5" aria-hidden />}
                label={t("selMenuAddPos")}
                onClick={() => void addKeyword("positive")}
              />
              <MenuButton
                icon={<ShieldMinus className="h-3.5 w-3.5" aria-hidden />}
                label={t("selMenuAddNeg")}
                onClick={() => void addKeyword("negative")}
              />
              <MenuButton
                icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}
                label={t("selMenuAddEngaged")}
                onClick={() => void addKeyword("engaged")}
              />
              <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            </>
          )}
          <MenuButton
            icon={<Search className="h-3.5 w-3.5" aria-hidden />}
            label={t("selMenuSimilar")}
            onClick={similarSearch}
          />
          <MenuButton
            icon={<MessageCircle className="h-3.5 w-3.5" aria-hidden />}
            label={t("selMenuAskAi")}
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
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-ink hover:bg-accent"
    >
      {icon}
      <span className="hidden whitespace-nowrap sm:inline">{label}</span>
    </button>
  );
}
