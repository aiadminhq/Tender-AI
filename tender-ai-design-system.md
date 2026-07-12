---
title: "tender-ai-design-system-260617"
type: reference
category: development
tags: [tender-ai, design-system, tokens, hq-site-log, cjk, light-mode]
status: draft
created: 2026-06-17
updated: 2026-07-10
author: claude-cowork
---

# Tender AI 設計系統（v0.2 — 移植 HQ Site Log 美感）

> v0.2 起，視覺語言**移植自 HQ Site Log（惠強工地簽到 PWA + Glaze 桌機後台）**，
> 讓兩個 App 看起來像同一家族：**紙面亮色為主、navy 冷暖中性灰、柔和擴散陰影、
> 圓角 pill 標籤、朱紅（HQ Vermillion）品牌 accent**。
> 兩條鐵則不變（使用者要求）：**① 中文不用海報級大字——字級收斂；② 絕不用襯線字（serif）。**

---

## 1. 從 v0.1（暗色）到 v0.2（HQ 紙面）的關鍵轉變

| 面向 | v0.1（暗色為主） | v0.2（HQ 紙面美感） |
|---|---|---|
| 主題 | 暗色為主、附 light | **亮色為主**（紙白卡面浮於淺 navy 冷底）、附 dark（navy 深面，非純黑） |
| 中性色 | 純灰（#141414/#9b9b9b） | **HQ navy 冷暖中性**（非純灰，與品牌 navy 諧和） |
| 品牌 accent | 無（只有藍 signal） | **HQ Vermillion 朱紅 `#D64518`**（品牌標記 / AI 推薦 / hero 強調） |
| 深度 | 幾乎無陰影（暗底靠 lift） | **強調柔和擴散陰影**（HQ shadow-card / shadow-float）＋ hairline 細框 |
| 語意色 | tier 三階 + priority | **更豐富但克制**：success / warning / danger / info + 推薦(brand) / 最優先(priority) |
| 標籤 | 方角 / 小圓角 | **一律圓角 pill**＋語意色點（HQ 狀態 pill 風格） |

保留 Framer/HQ 精神：用 **surface lift（canvas→surface-1→surface-2）** 表層級、
藍色只當互動訊號、語意色面積小（徽章／點，不鋪底）、漸層只用在可行性強調、數字 tabular。

---

## 2. Design Tokens（`src/index.css` 為單一真實來源）

亮色為預設；`[data-theme="dark"]` 覆寫 primitive。以下為亮色值：

```css
/* surface —— 紙白卡面浮於極淺 navy 冷底 */
--canvas:#eef2f7; --surface-1:#ffffff; --surface-2:#e7edf4;
--hairline:#e1e8f0; --hairline-soft:#eef2f6;
/* ink —— navy 冷暖中性（非純灰） */
--ink:#1f2a36; --ink-muted:#4a5a6b; --ink-dim:#8494a4;
/* 品牌 accent（HQ Vermillion）＋ 互動訊號（藍） */
--brand:#d64518; --brand-hover:#ba3a12; --brand-ring:rgba(214,69,24,.22);
--signal:#2563eb; --signal-ring:rgba(37,99,235,.24);
/* 語意：潛力分級／狀態（克制、面積小） */
--tier-high:#2f855a; --tier-mid:#b7791f; --tier-low:#dc2626;
--priority:#6d4aff;   /* ⭐ 期間最優先 */
--recommend:#d64518;  /* 🤖 AI 推薦 = 品牌朱紅 */
--success:#2f855a; --warning:#b7791f; --danger:#dc2626; --info:#2563eb;
/* 可行性漸層（唯一允許漸層用途之一） */
--feasibility-from:#2f855a; --feasibility-to:#2563eb;
/* 陰影 —— HQ 柔和擴散（navy 染色，非純黑） */
--shadow-soft:0 1px 2px rgba(31,42,54,.06);
--shadow-card:0 8px 24px -12px rgba(31,42,54,.18);
--shadow-float:0 20px 48px -20px rgba(31,42,54,.28);
--radius:12px; /* 卡片 rounded-xl；pill 999px */
```

暗色（對齊 HQ `surface-dark`，navy 深面）：`--canvas:#0f1720; --surface-1:#18232f;
--surface-2:#222f3c; --ink:#f1f5f9;` 語意色提亮（tier-high `#34d07f` 等），陰影加深。

Tailwind v4 以 `@theme inline` 暴露為工具類：`bg-brand`、`text-recommend`、
`bg-warning/14`、`shadow-card`、`shadow-float` 等；切 `[data-theme]` 即整體跟著變。

---

## 3. Typography（不變：CJK 適配、無大字、無 serif）

最大標題 22px；資料 13–15px；數字一律 `tabular-nums`（`.tnum`）。
負字距只給 Latin；CJK `letter-spacing:0`。weight 集中 400/500/600。**嚴禁 serif。**

---

## 4. 元件規格（落在上面的 token）

- **card / stat-card**：`bg-card` 紙白＋`border-hairline`＋`shadow-card`，hover→`shadow-float`；`rounded-xl`。
- **button**：一般主行動 = ink 深色 pill（`shadow-soft`）；**招牌動作「承接標案」= `brand` 朱紅 pill**
  （唯一的品牌 CTA moment，對齊 HQ 自信用朱紅的作風，不氾濫）；secondary = 白底 hairline pill；
  ghost = 透明。一律 `rounded-full`、pressed `scale(.97)`。
- **badge（pill）**：柔和 tint 底（色 `/12`）＋同色文字＋可選語意色點（`dot`）。
  變體：`signal / success / warning / danger / info / recommend / priority / muted / solid`。
- **tier-badge**：潛力 pill，語意色點 + 8~12% tint 底，克制。
- **AI 推薦標籤**：`recommend`（朱紅）pill + `Sparkles` 圖示，僅在推理判定 `strong` 時出現。
- **feasibility-meter**：`bg-surface-2` 軌 + 綠→藍漸層填色（唯一允許漸層之一）。
- **source-status pill**：已連線 `success`／未綁定 `muted`／離線 `warning`（帶色點）。
- **filter-chip**：pill；active 以 lift（`surface-2`）表示，非換色。

### 深度（HQ 化）
0 canvas 文字｜1 `shadow-soft` 細抬升｜2 `shadow-card` 卡片｜3 `shadow-float` 浮卡/放大/抽屜｜
focus `--signal-ring` 1px 環。

---

## 5. Do / Don't

**Do**：亮色紙面為基底、柔和陰影＋hairline 表層級；藍色只當互動訊號；朱紅當品牌／推薦強調；
語意色克制、面積小、一律 pill；漸層只用在可行性；數字 tabular。

**Don't**：❌ 任何 serif；❌ 中文海報級大字或負字距；❌ 藍色當按鈕底色；❌ 漸層鋪整段；
❌ 同畫面三種以上彩色 accent 互搶；❌ 方角 CTA；❌ 重陰影＋大位移的花俏 hover。

---

## 6. 響應式（不變）

斷點 1200 / 810 / 640。≤810 filter bar 折疊；≤640 標案表格轉卡片列、觸控目標 ≥44px。

---

*實作參考：`tender-ai-frontend/src/index.css`（token 單一來源）與各 `components/ui/*`。*
