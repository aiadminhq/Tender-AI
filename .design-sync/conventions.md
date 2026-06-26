# Tender AI — 設計系統使用慣例 (House Style)

> 本檔說明用這些元件構圖時的品牌與一致性規則。請依此構圖，不要自創偏離規範的樣式。
> Tender AI 是「幫人篩選政府標案、且越用越聰明」的系統；介面以**深色儀表板／App UI**為主、繁中為預設語言。

## 主題與表面 (Theme & Surface)

- **預設深色**。主題切換靠 HTML `[data-theme]`（`dark` 預設、`light` 次之），元件用 CSS 變數 token 取色，**不要**寫死十六進位色值。
- 一律以 `ThemeProvider` 包裹根節點（已自動套用），其餘元件吃同一組 token。
- 卡片採 **Bento 分區**：清楚的卡片邊界、區塊化資訊；只允許極輕陰影 `0 1px 2px rgba(0,0,0,.06)`，**禁濃重投影**。

## 形狀與間距 (Shape & Spacing)

- 圓角：卡片／容器 **16px**；按鈕 **12px**（`rounded-xl`，icon 按鈕用 `rounded-md`）。
- 極簡直線、零手寫/抖動風格。留白優先於裝飾線。

## 字體 (Typography)

- 繁中：**Noto Sans TC**（**CJK 永不使用 serif**）。
- 英文：**Inter** / SF Pro Text。
- 數字／金額／程式碼／日期：**JetBrains Mono** / SF Mono（如預算 `NT$ 28,500,000`、截止日 `2026/07/18`）。
- 字級對比要明確（標題 vs 內文 vs 次要說明），但跨卡片保持收斂。

## i18n

- 新增文案一律 **zh / en 成對**，繁中為預設；切語言只換字串，不改版面。
- `TierBadge` 等帶 `lang` 的元件用 prop 切換文案（high/mid/low → 高潛力/中潛力/低潛力 或 High/Medium/Low）。

## 領域元件用法 (Domain components)

- `FeasibilityMeter`：AI 大腦算出的「可行度」(0–100) 視覺化；綠→紅漸層是少數允許的漸層用途。值越高條越長，`showLabel` 顯示右側數字。
- `TierBadge`：標案承接優先級（high/mid/low），帶語意色點，常與標案名稱並排。
- `MaximizableCard`：包圖表／長表格，平常態為卡殼、右上放大鈕可切全螢幕；`actions` 槽放標題列右側操作（如數量 Badge）。
- `Sheet`：右側滑出抽屜，做標案詳情側欄；底部放「略過 (ghost)」與「承接此案 (primary)」雙鈕。
- `Avatar`：白名單同事的**具名**貢獻（Layer B 在合作範圍內具名共享），可帶 `ring` 與疊加排列。
- `Badge` 的 `signal` 變體用於「⭐ 精選案件」這類強調；`category`／`default` 用於標案類別（如「營繕工程」）。

## 構圖原則

- 真實情境優先：用標案名稱、機關、預算、截止日、可行度等真實欄位組合，而非 lorem。
- 一個畫面一個主焦點；次要資訊降低對比、縮小字級，不要與主資訊爭視線。
