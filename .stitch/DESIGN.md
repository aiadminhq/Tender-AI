# Tender AI - Stitch 設計靈感實驗場系統 (DESIGN.md)

本文件是為 **Tender AI** 在 **Stitch** 中生成新頁面的「設計系統規範之源 (Source of Truth)」。為了解放您的設計靈感，我們在此提供**三種完全不同美學風格的設計預設**，您可以挑選任一風格拷貝至 Stitch Prompt 中進行實驗生成。

---

## 1. 三種前衛設計美學風格 (Experimental Styles)

### 方案 A：極簡溫暖 Bento 風 (Warm Editorial Bento - 專案預設升級版)
*   **視覺氛圍**：極簡、溫暖、專業。將繁複的招標資料放入規整的 Bento 卡片中，透過強烈的字級與字重對比，塑造像高品質紙質雜誌一樣的閱讀體驗。
*   **色盤**：
    *   頁面畫布 (Canvas)：`#FDFDFD` (極微暖的紙張白)
    *   卡片表面 (Surface)：`#FFFFFF` (純白)
    *   主品牌色 (Accent/Orange)：`#F97316` (活力暖橘，用於高亮、主要狀態與 CTA)
    *   主要文字 (Ink-Primary)：`#18181B` (深炭黑)
    *   次要文字 (Ink-Muted)：`#71717A` (中灰)
    *   細邊框線 (Hairline)：`#E4E4E7` (淺灰線)
*   **組件形體**：
    *   卡片與彈窗：`rounded-2xl` (16px 圓角)，帶有 whisper-soft 陰影 (`box-shadow: 0 1px 3px rgba(0,0,0,0.02)`)。
    *   按鈕：`rounded-full` (膠囊形) 或 `rounded-xl` (12px)。
*   **Stitch 專用 Prompt 設定區 (風格 A)**：
    ```markdown
    [STYLE: Warm Bento]
    Atmosphere: Minimalist Warm Gray & Vibrant Orange accent. Crisp editorial hierarchy.
    Colors: Canvas (#FDFDFD), Surface (#FFFFFF), Primary Accent (#F97316), Primary Text (#18181B), Border (#E4E4E7).
    Geometry: Cards rounded-2xl (16px), Buttons rounded-full (capsule) or rounded-xl. Fine 1px borders, subtle soft shadows (0 1px 3px rgba(0,0,0,0.02)).
    Typography: Noto Sans TC & Inter. High typographic scale contrast.
    ```

### 方案 B：深邃黑琥珀空間風 (Dark Spatial Amber - 深夜挑案推薦)
*   **視覺氛圍**：深邃、沉浸、數位。為需要長時間盯著大量政府標案的 David 設計。純黑背景搭配琥珀霓虹高光，卡片具有玻璃擬態 (glassmorphism) 的半透明層次，非常適合暗色儀表板。
*   **色盤**：
    *   頁面畫布 (Canvas)：`#09090B` (純暗黑)
    *   卡片表面 (Surface)：`rgba(20, 20, 23, 0.6)` (帶有 `backdrop-filter: blur(12px)` 的暗色半透卡)
    *   主品牌色 (Accent/Amber)：`#F59E0B` (溫暖琥珀霓虹，像儀表指針一樣明亮)
    *   主要文字 (Ink-Primary)：`#FAFAFA` (極光白)
    *   次要文字 (Ink-Muted)：`#A1A1AA` (淡灰)
    *   細邊框線 (Hairline)：`rgba(255, 255, 255, 0.08)` (微光邊框)
*   **組件形體**：
    *   卡片與彈窗：`rounded-2xl` (16px 圓角)，搭配極微弱的琥珀色發光投影。
    *   按鈕：`rounded-lg` (8px 圓角，俐落科幻質感)。
*   **Stitch 專用 Prompt 設定區 (風格 B)**：
    ```markdown
    [STYLE: Dark Spatial Amber]
    Atmosphere: Cyberpunk-lite, Dark canvas with neon Amber glow. Spatial elevation with frosted glass effect.
    Colors: Canvas (#09090B), Surface (rgba(20,20,23,0.6) with blur), Accent (#F59E0B), Text (#FAFAFA), Border (rgba(255,255,255,0.08)).
    Geometry: Cards rounded-2xl (16px), sharp-edges on minor indicators, buttons rounded-lg. Glowing hairline borders.
    Typography: JetBrains Mono & Inter.
    ```

### 方案 C：復古單色排版風 (Retro Riso Mono - 簡約風骨)
*   **視覺氛圍**：復古孔版印刷 (Riso) 質感，大膽的雙色搭配，強調實用主義與強烈的形式美感。完全去除漸層與陰影，全憑線條與高對比色塊區分層級。
*   **色盤**：
    *   頁面畫布 (Canvas)：`#F4F0EA` (復古米黃粗糙紙張色)
    *   卡片表面 (Surface)：`#FBF9F6` (淺米白卡片)
    *   主品牌色 (Accent/Blue-Green)：`#0F766E` (復古深青綠，用於所有線條與點綴)
    *   主要文字 (Ink-Primary)：`#1F2937` (墨水黑)
    *   次要文字 (Ink-Muted)：`#4B5563` (中灰墨水)
    *   細邊框線 (Hairline)：`2px solid #0F766E` (粗曠的深青線框)
*   **組件形體**：
    *   卡片與彈窗：`rounded-none` (直角無圓角) 或 `rounded-sm` (4px)。
    *   無任何投影，使用硬色塊投影 (Offset border shadow: `3px 3px 0px #0F766E`)。
*   **Stitch 專用 Prompt 設定區 (風格 C)**：
    ```markdown
    [STYLE: Retro Riso Mono]
    Atmosphere: Retro Risograph print texture, high-contrast flat layout. No gradients, no soft shadows.
    Colors: Canvas (#F4F0EA), Surface (#FBF9F6), Accent (#0F766E), Text (#1F2937), Border (2px solid #0F766E).
    Geometry: Flat squared-off edges (rounded-none), solid block offsets instead of shadows (box-shadow: 3px 3px 0px #0F766E).
    Typography: Courier Prime & Noto Sans TC.
    ```

---

## 2. 全域 UI 組件規範 (Global Elements)

在為任何頁面撰寫 Stitch Prompts 時，請務必指示 Stitch 實作以下**特有功能組件**的視覺呈現：

1.  **Feasibility Score Meter (可行性分數儀表)**：
    不要使用一般的進度條。應描述為：「一個半圓形弧形儀表 (Gauge) 或環形進度環，中間顯示大字可行性百分比 (例如 76%)，下方附帶一小行淺灰色的 AI 推薦歸因（例如：基於相似工程案與重點字推薦）。」
2.  **Tender Category Badges (標案分類徽章)**：
    根據標案類型呈現不同徽章：
    *   `工程`：翠綠色背景與圖示
    *   `財物`：湛藍色背景與圖示
    *   `勞務`：紫羅蘭背景與圖示
3.  **David's Decision Action Hub (決策行動組件)**：
    承接與略過按鈕，要成為明確的焦點：
    *   「承接 (Accept)」：高對比主色按鈕。
    *   「略過 (Ignore)」：低調的灰白色按鈕。
    *   「精選⭐ (Star)」：在卡片右上角的常駐微交互空心星號。
4.  **Tender Assistant Floating Widget (標案助手浮窗)**：
    右下角有一個常駐但精緻的圓形懸浮按鈕 (FAB)，帶有機器人或對話框圖標。點擊後，右側滑入一個寬度適中的不阻擋式浮窗，含有漂亮的對話氣泡流與輸入框，標題為「指揮中心」。
