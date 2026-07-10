---
page: dashboard
---
一個針對 Tender AI 案源決策系統「首頁指揮中心 (Dashboard)」的極簡溫暖 Bento 風格網頁。
目標是為使用者 (主要挑案者 David) 提供今日最優先的標案決策入口，並展示 AI 大腦的學習健康狀態。

**DESIGN SYSTEM (REQUIRED):**
[STYLE: Warm Bento]
Atmosphere: Minimalist Warm Gray & Vibrant Orange accent. Crisp editorial hierarchy.
Colors: Canvas (#FDFDFD), Surface (#FFFFFF), Primary Accent (#F97316), Primary Text (#18181B), Border (#E4E4E7).
Geometry: Cards rounded-2xl (16px), Buttons rounded-full (capsule) or rounded-xl. Fine 1px borders, subtle soft shadows (0 1px 3px rgba(0,0,0,0.02)).
Typography: Noto Sans TC & Inter. High typographic scale contrast.

**Page Structure:**
1. **頂部導航與登入狀態**：
   - 帶有細線邊框的乾淨 Header，包含「Tender AI」標誌與簡短導覽。
   - 右側顯示當前使用者：David（帶有小小的「@hqdesign.tw 白名單已開通」與「Layer B 同意共享數據」的綠色狀態點）。
2. **頂部 KPI 數據統計 (Bento Row)**：
   - 包含三張乾淨的統計卡片：
     * 卡片 A：今日新增採購網標案數（大字 142 筆，下方小字標記「+12 較昨日」）。
     * 卡片 B：本月已承接備標中（大字 8 筆，帶有橙色高光）。
     * 卡片 C：AI 學習演化狀態（大字「運作中」，附帶小字「已積累 64 個行為樣本，已跨越 50 門檻自演化」）。
3. **今日最優先標案 (David's Top Focus) - 核心區塊**：
   - 一個佔據 2/3 寬度的 Bento 大卡片，標題為「今日焦點 (最優先⭐ & 即將截止)」。
   - 卡片內含 3 列高密度的標案快速預覽列：
     * 第一列：醫院衛浴更新與感控改善工程｜預算 3,360 萬｜剩餘 12 天｜可行性評分 76% (以橙色弧形進度儀表顯示)｜右側有「快速預覽」與「✓承接」按鈕。
     * 第二列：北醫大樓天花板修繕採購｜預算 450 萬｜剩餘 4 天｜可行性評分 82%｜右側有按鈕。
4. **大腦健康度與團隊貢獻榜 (右側 1/3 區塊)**：
   - 上卡：AI 推薦關鍵字健康度儀表。顯示目前重點推薦詞（如：工程、裝修）與迴避詞（如：勞務、清潔），下方有一個「大腦演化狀態：健康」的指示燈。
   - 下卡：團隊合作共享貢獻榜。顯示 Christian Wu (貢獻 24 個評價)、Aaron (貢獻 12 個評分)，並加註「Layer B 白名單合作共享中」。
5. **全站右下角 AI 助手懸浮球 (FAB)**：
   - 右下角一個橙色背景的精緻對話圓型按鈕，帶有機器人小圖標，提示文字「標案助手 - 指揮中心已就緒」。
