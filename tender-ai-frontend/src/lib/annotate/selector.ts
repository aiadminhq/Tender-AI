// DOM → 穩定選擇器 / 元件猜測（純函式，可單測）。
// 標註工具用：把使用者點到的元素，描述成「CLI 看得懂、之後找得回來」的字串。
//
// 優先序：data-component / data-ds（最穩，元件自報家門）→ id → 穩定 class → nth-child 路徑。
// 刻意避開 hash 化的 utility class（Tailwind JIT 產生的 atomic class 不適合當定位錨）。

/** 偵測像是「自動產生／易變」的 class，定位時跳過。 */
function isVolatileClass(cls: string): boolean {
  return (
    cls.length === 0 ||
    // Tailwind / CSS-in-JS 常見：含 : [ ] / 等變體與任意值語法
    /[:[\]()/%#.]/.test(cls) ||
    // 純 hash（css-modules / emotion）
    /^[a-z0-9]{6,}$/i.test(cls) ||
    // 純數字或以數字開頭（非合法單獨 class 錨點）
    /^\d/.test(cls)
  );
}

/** 從 class 列表挑出語意化、穩定的 class（最多取 2 個，組合提升唯一性）。 */
function stableClasses(el: Element): string[] {
  const list = Array.from(el.classList).filter((c) => !isVolatileClass(c));
  // 偏好含連字號的語意命名（如 tier-badge、rules-panel），其次一般單字。
  list.sort((a, b) => {
    const aSem = a.includes("-") ? 0 : 1;
    const bSem = b.includes("-") ? 0 : 1;
    return aSem - bSem;
  });
  return list.slice(0, 2);
}

/** 元素在同類兄弟中的位置（1-based），給 nth-of-type 用。 */
function nthOfType(el: Element): number {
  let i = 1;
  let sib = el.previousElementSibling;
  while (sib) {
    if (sib.tagName === el.tagName) i += 1;
    sib = sib.previousElementSibling;
  }
  return i;
}

/** 單一層級的選擇器片段。 */
function segment(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const classes = stableClasses(el);
  if (classes.length) return `${tag}.${classes.join(".")}`;
  return `${tag}:nth-of-type(${nthOfType(el)})`;
}

/**
 * 產生指向 el 的選擇器。
 * - 命中 data-component / data-ds：直接回傳屬性選擇器（最穩）。
 * - 命中 id：回傳 #id。
 * - 否則：從 el 往上走，組出夠唯一的後代路徑（碰到 data-* 錨點或 id 即停）。
 */
export function buildSelector(
  el: Element | null,
  root: Document = document,
): string {
  if (!el) return "";

  const comp = el.getAttribute("data-component");
  if (comp) return `[data-component="${comp}"]`;
  const ds = el.getAttribute("data-ds");
  if (ds) return `[data-ds="${ds}"]`;
  if (el.id && !isVolatileClass(el.id)) return `#${el.id}`;

  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;

  while (
    cur &&
    cur.nodeType === 1 &&
    cur !== root.documentElement &&
    depth < 6
  ) {
    // 祖先若有 data-* 錨點或 id，接上後直接收尾（夠定位了）。
    const anchorComp = cur.getAttribute?.("data-component");
    const anchorDs = cur.getAttribute?.("data-ds");
    if (anchorComp) {
      parts.unshift(`[data-component="${anchorComp}"]`);
      break;
    }
    if (anchorDs) {
      parts.unshift(`[data-ds="${anchorDs}"]`);
      break;
    }
    if (cur.id && !isVolatileClass(cur.id)) {
      parts.unshift(`#${cur.id}`);
      break;
    }
    parts.unshift(segment(cur));
    cur = cur.parentElement;
    depth += 1;
  }

  return parts.join(" > ");
}

/** 猜這個元素「是什麼元件」：data-component → data-ds → 語意 class → 標籤名。 */
export function guessComponent(el: Element | null): string {
  if (!el) return "";
  const comp = el.getAttribute("data-component") || el.getAttribute("data-ds");
  if (comp) return comp;
  const semantic = Array.from(el.classList).find(
    (c) => c.includes("-") && !isVolatileClass(c),
  );
  if (semantic) return semantic;
  return el.tagName.toLowerCase();
}

/** 擷取元素可見文字片段（去除多餘空白、截斷）。 */
export function textSnapshot(el: Element | null, max = 80): string {
  if (!el) return "";
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
