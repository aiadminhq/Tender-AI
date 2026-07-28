# 設計系統呈現頁 ＋ 即時標註回傳工具

> 日期：2026-06-25 ｜ 範圍：`tender-ai-frontend` ｜ 狀態：設計已核可，開發中
> 分支：`claude/busy-sagan-gm197s`

> **狀態（2026-06-25 補注）**：🟡 規格定案／開發中（2026-06-25）。設計系統呈現頁＋即時標註回傳工具（Track B），dev-time 工具、不碰 Layer B。對應 commit `e1bba1f`（規格）。
> 本規格為設計當時記錄。回饋交接機制已改為「複製／下載任務提示詞後人工遞交」，不再使用 Vite 寫檔 middleware 或自動啟動 CLI；最新行為以程式碼與 `docs/design-feedback-workflow.md` 為準。

## 目標（要解決什麼）

讓非工程的設計／需求者，能在**正在跑的前端畫面上**直接：

1. 一頁看完目前所有**設計 tokens 與元件**（design system showcase）。
2. 在**任一頁面、任一 DOM/div** 上點擊 → 跳彈窗 → 輸入修改建議。
3. 把這些建議**結構化回傳給 Claude Code CLI**，讓 AI 拿到「指向哪個元件、在哪一頁、想怎麼改」的明確指示，而不是口述。

這是一個 **dev-time 內部工具**：只在開發環境出現，正式環境使用者永遠看不到。

## 兩個子系統

### B1 — 設計系統呈現頁（`/design-system`）

- 路由 dev-gated：`{import.meta.env.DEV && <Route path="/design-system" .../>}`，正式 build 不存在。
- 不套用一般導覽殼以外的特殊邏輯；走標準 `AppShell`（左側欄會多一個僅 dev 顯示的入口，或直接用網址進入）。
- **Tokens 區**：用 `getComputedStyle(document.documentElement)` **即時讀** `src/index.css` 的 CSS 變數（顏色、radius、shadow、字體），所以永遠跟真實 token 同步，不手抄。色票同時顯示亮／暗（讀目前 `data-theme`，可切換觀察）。
- **元件 gallery**：策展式列出既有 atom／分子元件的各 variant／size／state：`Button`、`Badge`、`Alert`、`Card`、`Input`、`Switch`、`Separator`、`Tabs`、`TierBadge`、`TrendBadge`、`CategoryIcon/CategoryBadge`。每個展示區塊掛 `data-ds="<元件名>"`，方便標註精準命中。
- i18n：標題與區段文案 zh/en 成對，繁中預設。

### B2 — 全域標註層（標註工具）

- **常駐入口**：上方 toolbar（`topbar.tsx`）放一顆**箭頭 SVG icon** 按鈕（lucide `MousePointer2`），dev-gated。點一下進入／退出「標註模式」。
- **選取任一 DOM**：標註模式下，滑鼠移過會 highlight 可選元素；點擊 → 在點擊位置附近彈出**輸入彈窗**（沿用 `SelectionMenu` 的 portal＋定位＋clamp 模式）。
- **彈窗內容**：建議文字（textarea）＋類型 chips（`視覺`/`互動`/`文案`/`版面`/`其他`）＋嚴重度（`建議`/`重要`/`阻擋`）＋「此元件是什麼」自動猜測（讀 `data-component`/`data-ds`/className）。送出後在該位置留下**編號圖釘**。
- **捕捉期攔截**：標註模式下點擊以 capture phase `preventDefault + stopPropagation`，避免觸發 App 既有導覽。
- **排除自身 UI**：工具自己的 DOM 標 `data-annotate-ui`，命中時 `.closest('[data-annotate-ui]')` 直接略過。
- **掛載位置**：`<AnnotationLayer />` 掛在 `BrowserRouter` 內、`Routes` 外（兄弟節點），一次涵蓋所有頁（含獨立路由 `/knowvio`、`/design-system`），且 `useLocation` 可用。

### 標註資料模型

每筆標註（`Annotation`）：

```
id            // crypto.randomUUID()
route         // location.pathname
selector      // 穩定選擇器（優先 data-component/data-ds → 穩定 class → nth-child 路徑）
componentGuess// 從 data-* / className 猜的元件名
textSnapshot  // 命中元素的可見文字片段（截斷）
rect          // 命中當下的 boundingRect（給圖釘定位參考）
type          // 視覺 | 互動 | 文案 | 版面 | 其他
severity      // 建議 | 重要 | 阻擋
comment       // 使用者輸入
createdAt     // new Date().toISOString()（瀏覽器端允許）
```

### 狀態與持久化

- module-level store ＋ `useSyncExternalStore`（不動 provider 樹）。
- `enabled`（標註模式開關）：暫態，不持久化。
- `annotations`：持久化到 `localStorage` key `tender-ai:design-feedback`，重整不掉。

## 回傳機制（歷史設計，已由人工提示詞交接取代）

序列化所有標註成**結構化 Markdown**（依 route 分組，含 selector／componentGuess／type／severity／comment／textSnapshot）：

- 現行作法：依使用者選擇的目標生成結構化任務提示詞，複製到剪貼簿；無法複製時下載 `.md`。
- 使用者自行檢閱後貼入目標工具；系統不會建立本機 inbox、啟動或控制 CLI。
- 後端彙整是獨立且可選的保存流程，規格見 `docs/design-feedback-workflow.md`。

## 檔案清單

新增：

- `src/lib/annotate/selector.ts` — 純函式：DOM → 穩定選擇器。
- `src/lib/annotate/serialize.ts` — 純函式：annotations → Markdown。
- `src/lib/annotate/store.ts` — store（localStorage + useSyncExternalStore）。
- `src/components/annotate/annotation-layer.tsx` — 全域層（hover highlight＋click 攔截）。
- `src/components/annotate/annotation-panel.tsx` — 輸入彈窗。
- `src/components/annotate/annotation-pin.tsx` — 編號圖釘＋清單。
- `src/components/annotate/annotation-toggle.tsx` — toolbar 箭頭按鈕。
- `src/pages/design-system.tsx` — 呈現頁。

修改：

- `src/App.tsx` — 加 dev route ＋ 掛 `<AnnotationLayer />`。
- `src/components/layout/topbar.tsx` — 加箭頭 toggle（dev-gated）。
- `src/i18n/strings.ts` — 補 zh/en 文案。

## 邊界與非目標

- 不做帳號綁定、不寫進 Layer B 知識庫；這是**開發時的介面回饋**，與標案學習資料完全無關，不碰共享紅線。
- 不在正式 build 出現（全程 `import.meta.env.DEV` 閘）。
- 不追求像素級量測工具；定位以「指到對的元件＋寫清楚想改什麼」為準。

## 驗證

- `/design-system` 能開、tokens 即時反映 `index.css`、元件 variant 齊全。
- toolbar 箭頭可切換標註模式；任一頁點 DOM 出彈窗、可輸入、留圖釘、重整不掉。
- 送出後能取得可複製的結構化任務提示詞；剪貼簿不可用時提供下載後援。
- House style：繁中 Noto Sans TC、16px 圓角系統、僅淡陰影、i18n 成對。
