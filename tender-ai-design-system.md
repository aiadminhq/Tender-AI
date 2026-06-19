---
title: "tender-ai-design-system-260617"
type: reference
category: development
tags: [tender-ai, design-system, tokens, framer, cjk, dark-mode]
status: draft
created: 2026-06-17
author: claude-cowork
---

# Tender AI 設計系統（v0.1）

> 改編自 Framer 的 `DESIGN.md`（暗色 canvas、單一藍 accent、surface lift、pill、Inter Variable），但**重新適配為「資料型 app」與「繁體中文」介面**。
> 兩條鐵則（使用者要求）：**① 中文不用很大的字——字級全面收斂、無海報級 display；② 絕對不用襯線字（serif）——Latin 與 CJK 一律 sans。**

---

## 1. 與 Framer 原系統的關鍵差異

| 面向 | Framer（行銷站） | Tender AI（資料 app） |
|---|---|---|
| 字級 | 海報級（display 110/85/62px） | **收斂**：最大標題 24–28px，資料 13–15px |
| 字距 | display 拉到 -5.5px | **僅 Latin 微負字距；CJK 字距 = 0**（中文不套負 tracking） |
| 字體 | GT Walsheim + Inter | Inter（Latin）+ **Noto Sans TC / PingFang TC**（CJK），皆 sans，**無 serif** |
| 顏色 | 單色 + 1 藍 + 漸層卡 | 同基底，但**新增克制的語意色**（潛力分級必要） |
| 漸層 | 招牌氛圍卡 | **僅用於可行性/最優先強調**，不鋪整段 |
| 主題 | 只有暗色 | **暗色為主、附 light token**（雙主題鎖定需求） |

保留 Framer 精神：暗色 canvas 即留白、用 **surface lift（canvas→surface-1→surface-2）** 表達層級、**pill 按鈕**、**藍色只當訊號**（連結/focus/selected）。

---

## 2. Design Tokens（CSS variables，可直接複製）

```css
:root, [data-theme="dark"] {
  /* surface */
  --canvas:#090909; --surface-1:#141414; --surface-2:#1c1c1c;
  --hairline:#262626; --hairline-soft:#1a1a1a;
  /* ink（層級以 ink→ink-muted 為主，資料密集再用 ink-dim） */
  --ink:#ffffff; --ink-muted:#9b9b9b; --ink-dim:#6b6b6b;
  /* signal accent（只用於連結/focus/selected） */
  --accent:#0099ff; --accent-ring:rgba(0,153,255,.30);
  /* 語意：潛力分級／狀態（克制使用） */
  --tier-high:#22c55e;   /* 🟢 高潛力 ≤14 */
  --tier-mid:#f5a623;    /* 🟡 中潛力 15–30 */
  --tier-low:#ff5577;    /* 🔴 低潛力 ≥31 */
  --priority:#7c6bff;    /* ⭐ 期間最優先（violet，取自 Framer 漸層族） */
  --success:#22c55e; --danger:#ff5577;
  /* 可行性分數漸層（唯一允許的漸層用途之一） */
  --feasibility:linear-gradient(90deg,#22c55e,#0099ff);
  /* on-color */
  --on-primary:#000000;
}

[data-theme="light"] {
  --canvas:#f7f8fa; --surface-1:#ffffff; --surface-2:#eef1f5;
  --hairline:#e2e6ec; --hairline-soft:#eef1f5;
  --ink:#161b22; --ink-muted:#5b6573; --ink-dim:#8a93a3;
  --accent:#0a6cff; --accent-ring:rgba(10,108,255,.25);
  --tier-high:#16a34a; --tier-mid:#c77700; --tier-low:#dc2626;
  --priority:#5b46e0; --success:#16a34a; --danger:#dc2626;
  --feasibility:linear-gradient(90deg,#16a34a,#0a6cff);
  --on-primary:#ffffff;
}

:root{
  /* radius（沿用 Framer） */
  --r-xs:4px; --r-sm:6px; --r-md:10px; --r-lg:14px; --r-xl:20px; --r-pill:999px;
  /* spacing（4 基準，較適合資料密度，略調 Framer 的 5 基準） */
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:20px; --s-6:24px; --s-8:32px;
  /* type families（無 serif） */
  --font-sans:"Inter","Noto Sans TC","PingFang TC","Microsoft JhengHei",
              system-ui,-apple-system,"Segoe UI",sans-serif;
  --font-num:"Inter",ui-monospace,"SF Mono",monospace; /* tabular 數字 */
}
```

---

## 3. Typography（CJK 適配、無大字、無 serif）

| Token | size / weight / line | tracking | 用途 |
|---|---|---|---|
| `display` | 24px / 600 / 1.2 | Latin -0.4px・**CJK 0** | 頁面主標題（最大就到這） |
| `title` | 18px / 600 / 1.3 | Latin -0.3px・CJK 0 | 區塊標題、卡片標題 |
| `subtitle` | 16px / 500 / 1.4 | 0 | 次標、抽屜標題 |
| `body` | 15px / 400 / 1.5 | 0 | 內文、標案名稱 |
| `body-sm` | 13px / 400 / 1.5 | 0 | 次要資訊、機關列 |
| `caption` | 12px / 500 / 1.3 | 0 | 標籤、meta、表頭 |
| `micro` | 11px / 500 / 1.3 | 0 | 角標、footnote |
| `num` | 15px / 600・`font-variant-numeric:tabular-nums` | 0 | 預算、天數、分數 |

實作規則：

- **負字距只給 Latin display/title**；中文（CJK）一律 `letter-spacing:0`。做法：display/title 用 `--font-sans`（Inter 在前，遇 CJK 自動 fallback Noto Sans TC），並把負 tracking 控在 ≤0.4px，避免中文擠在一起。
- **數字（預算/天數/可行性）一律 `tabular-nums`**，欄位才會對齊。
- weight 集中 400/500/600，靠 size + ink 對比分層，不上 700/900。
- **嚴禁 serif / 手寫體 / 裝飾字**。

---

## 4. 元件規格（對應 Tender AI 介面）

> 視覺語彙取自 21st.dev / shadcn 風格（乾淨、低噪、pill 與細 hairline），落在上面的 token 上。

- **button-primary**：白色 pill（`--ink` 底、`--on-primary` 字），`--r-pill`，padding 8×16。用於主行動（如「承接」）。pressed = `transform:scale(.97)`。
- **button-secondary**：炭色 pill（`--surface-1`），次要行動（轉發、略過）。
- **button-ghost / icon**：透明或 `--surface-1` 圓鈕（`--r-pill`，36–40px），列上的星號/更多。
- **filter-chip**：pill；default = `--canvas`/`--ink-muted`、active = `--surface-2`/`--ink`（**以 lift 表示選中、非換色**）；潛力 chip 左側加 6px 語意色點。
- **input / search**：`--surface-1`、`--r-md`、focus = `0 0 0 1px var(--accent-ring)` 藍環。
- **keyword-tag（重點/避免）**：重點 = 藍點 outline pill；避免 = `--danger` 細框 pill，可一鍵移除（×）。
- **stat-card**：`--surface-1`、`--r-lg`、padding 16；大數字用 `num`，標籤 `caption`/`--ink-muted`。
- **tender-row**：`--surface-1` 卡列、`--hairline` 分隔、hover→`--surface-2`；結構＝來源 pill｜標題+meta｜預算｜剩餘天數｜可行性分數+細 bar｜「承接」。
- **source-pill（TMU/PCC）**：小 outline pill，`caption`，selected 用 `--accent` 邊。
- **tier-badge**：語意色字 + 同色 8% 底，`--r-sm`，小字。
- **feasibility-meter**：`num` 百分比 + 4px 高 `--feasibility` 漸層 bar（唯一允許漸層之一）；或圓環。
- **drawer（詳情）**：右側滑出 `--surface-1`，level-2 light-edge。
- **empty-state**：置中圖標 + 一句 + 「放寬條件」`button-secondary`。

### 深度（沿用 Framer）
0 平面（canvas 上文字）；1 `--surface-1` lift；2 `rgba(255,255,255,.08)` 0.5px 上緣 + `rgba(0,0,0,.35) 0 10px 30px`（浮卡/抽屜）；3 `--accent-ring` 1px 環（focus/selected）。

---

## 5. Do / Don't（資料 app 版）

**Do**：暗色為基底、surface lift 表層級；藍色只當訊號；潛力語意色克制、面積小（徽章/點，不鋪底）；漸層只用在可行性/最優先強調；pill 一致；數字 tabular。

**Don't**：❌ 任何 serif；❌ 中文用海報級大字或負字距；❌ 藍色當按鈕底色（白 pill 才是主行動）；❌ 漸層鋪整段；❌ 同畫面三種以上彩色 accent；❌ 方角 CTA；❌ 中階灰文字（只用 `ink`/`ink-muted`，資料密集才動用 `ink-dim`）。

---

## 6. 響應式

斷點 1200 / 810 / 640。≤810：filter bar 折疊為「篩選」抽屜；stat 由 5→2 欄。≤640：**標案表格轉為卡片列**（避免橫向捲動）；觸控目標 ≥44px；pill 維持。

---

*實作參考：同資料夾 `prototype/index.html`（本系統的可互動靜態原型）。*
