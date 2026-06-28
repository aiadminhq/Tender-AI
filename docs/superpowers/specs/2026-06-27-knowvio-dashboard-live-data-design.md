---
status: 設計核准（/goal 自動安排，方案 A 已鎖定）
owner: Alex (alex@hqdesign.tw)
branch: claude/busy-sagan-gm197s
created: 2026-06-27
scope: 前端（fe）— 純前端，不動後端、不碰 Layer B 共享紅線
supersedes: roadmap「5 缺口」中對 #1 knowvio 的描述（#3/#4/#5 經查證已實作）
---

# Knowvio 儀表板：裝飾 mock → 真實資料接線（方案 A）

## 結論

`/knowvio` 戰情儀表板頁面（[knowvio-dashboard-page.tsx](../../../tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx)）目前**半接真實資料**：KPI 數值、平均分、即將截止清單已吃 `useAppData()`，但**趨勢圖、活動甜甜圈、KPI 變化徽章、截止表狀態欄、歡迎副標**仍是寫死的裝飾 mock。

本 spec 只做一件事：**把這些裝飾 mock 換成 store 已暴露、但頁面尚未取用的真實聚合**。經查證，所需資料 store 全部已提供（`trend7d`、`activity`、`metrics`、`cards`），**不需要任何新後端端點、不需 DB migration、不碰 Layer B**。屬低風險、可逆、純前端變更。

## 背景：路線圖前提已校正

先前 roadmap 列出「5 個前端缺口」。對實際 child component 查證後，其中 3 個早已實作：

| 缺口                       | 狀態               | 證據                                                                                                                                                                                                                        |
| -------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #3 decision-recommendation | ✅ 已接            | [tender-drawer.tsx:135](../../../tender-ai-frontend/src/components/tenders/tender-drawer.tsx) `fetchDecisionRecommendation`                                                                                                 |
| #4 keyword-candidates      | ✅ 已接            | [swipe-decision-dialog.tsx:93](../../../tender-ai-frontend/src/components/swipe/swipe-decision-dialog.tsx)、[judgment-reason-dialog.tsx:165](../../../tender-ai-frontend/src/components/tenders/judgment-reason-dialog.tsx) |
| #5 saved-searches          | ✅ 已接            | [app-data.tsx:694](../../../tender-ai-frontend/src/store/app-data.tsx) `fetchSavedSearches`/`postSavedSearch`                                                                                                               |
| #1 knowvio                 | ⚠️ 半接（本 spec） | 下表                                                                                                                                                                                                                        |
| #2 kanban 後端持久化       | ⏭️ 另開 spec       | 需新後端端點＋migration，不在本範圍                                                                                                                                                                                         |

## 範圍：5 處 mock → live

store（`useAppData()`）**已暴露但 knowvio 未取用**的真實資料：`trend7d: number[]`、`activity: ActivityItem[]`、`metrics`（含 `kpiNew/kpiHigh/kpiClosing/kpiInProgress/kpiAccepted`）、`cards: KanbanCard[]`（含 `status`/`tenderId`）。

| #   | 位置                                                                                                           | 現況（mock）                   | 改為                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| M1  | `ProgressArea` `SERIES`（[L548](../../../tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx)）            | 寫死 30 點                     | 綁 `trend7d`（真實近 7 日）；圖改為 7 點、X 軸標籤改「近 7 日」                   |
| M2  | `ActivityDonut` segs ＋ 中央「42」（[L705](../../../tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx)） | 寫死 45/25/20/10%＋42          | 由 `activity` 依 `kind` 真實彙總佔比；中央＝`activity.length`                     |
| M3  | KPI delta 徽章（[L177-201](../../../tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx)）                 | 寫死 "+12%"/"+5%"/"+10%"/"+6%" | 今日新案 delta 由 `trend7d` 末兩點算；無真實前值的 KPI 隱藏徽章（誠實，不灌假數） |
| M4  | `DeadlineTable` 狀態欄（[L827](../../../tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx)）             | 假 `statusByIdx[i % 3]` 輪播   | 以該標案在 `cards` 的 `status` 映射；無對應卡片＝「未開始」                       |
| M5  | 歡迎副標「3 件高潛力新案」（[L38/L79](../../../tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx)）      | 寫死「3」                      | 以 `metrics.kpiHigh` 插值（zh/en 成對）                                           |

**明確不做（YAGNI／另案）**：

- `QuickReview` 卡（[L868](../../../tender-ai-frontend/src/pages/knowvio-dashboard-page.tsx)）維持靜態 placeholder——它是未來「複盤練習」功能的佔位，無對應資料源，本 spec 不接。
- 側邊欄導覽（`KvSidebar`）維持視覺，不接路由——knowvio 為獨立 showcase 頁，不在 AppShell 導覽體系內。
- kanban 後端持久化（#2）另開 spec。
- 不新增後端端點、不改 `index.css`、不動 `kv` 區域調色盤。

## 設計原則

1. **誠實優先**：沒有真實前值的 delta 不假造，隱藏徽章勝過顯示假百分比。對齊本專案「不灌假數」既有註解（`metrics` 計算處 L600-601）。
2. **純衍生、不新增 state**：所有彙總用 `useMemo` 從既有 store 值算出；不新增 store 欄位、不新增 API。
3. **空資料優雅降級**：`activity` 為空 → 甜甜圈顯示空態；`trend7d` 為空 → 趨勢圖顯示空態。沿用 `DeadlineTable` 已有的 `live ? 無資料 : 示範資料載入中` 模式。
4. **House style 不變**：`kv` 區域淺色奶油＋橘調、16px 圓角、極輕陰影、JetBrains Mono 數字、zh/en 成對。

## 元件與資料流

```
useAppData()
  ├─ trend7d ──────────────► ProgressArea(series=trend7d)        [M1]
  ├─ activity ─┬──► donutSegs = useMemo(彙總 kind 佔比)  ──► ActivityDonut  [M2]
  │            └──► totalActions = activity.length      ──► 中央數字
  ├─ trend7d ──► kpiNewDelta = useMemo(末兩點百分比)     ──► KpiCard.delta  [M3]
  ├─ cards ────► statusByTenderId = useMemo(Map)         ──► DeadlineTable  [M4]
  └─ metrics.kpiHigh ──────► welcomeSub 插值              ──► TopWelcome     [M5]
```

- **kind → 桶映射（M2）**：`accept/judge → 評分標記`、`comment → 瀏覽/互動`、`move → 加入看板`、`skip/rule/import → 其他/動作`。最終以 4 桶對齊既有 `actView/actRate/actBoard/actExport` 四色，佔比四捨五入後正規化使總和=100%。
- **status 映射（M4）**：kanban `TaskStatus`（`todo/doing/review/done`）→ knowvio `StatusKind`（`notStarted/inProgress/inProgress/pending`）；查無卡片 → `notStarted`。沿用既有 `STATUS_STYLE` 配色，移除 `i % 3` 假輪播。

## 錯誤處理與邊界

- 所有新 `useMemo` 對空陣列回傳安全預設（0 段、空態、delta=null）。
- delta=null 時 `KpiCard` 不渲染徽章（新增 `delta?: string | null` 選用）。
- 不觸發任何網路請求；離線/雲端環境（連不到 PCC/Ollama）不受影響。

## 測試

- **單元（純函式抽出）**：把 M2 的 `kind → 四桶佔比正規化`、M4 的 `cards → statusByTenderId` 抽成純函式（如 `knowvio-aggregations.ts`），各補測試：
  - 空 `activity` → 4 桶皆 0、總和不爆。
  - 佔比正規化總和 = 100（含四捨五入修正）。
  - `cards` 多卡同 tenderId → 取最新/明確規則；查無 → `notStarted`。
- **回歸**：既有 `fetchTenders` 等測試不受影響（本 spec 不動 api 層）。
- **視覺驗收**：vite dev（5173）載入 `/knowvio`，確認趨勢圖為 7 點、甜甜圈佔比與圖例一致、截止表狀態非輪播、副標數字＝真實 kpiHigh；`preview_screenshot` 留證。
- 覆蓋率目標延續專案 >80%；純函式部分要求 100%。

## 後續（不在本 spec）

- #2 kanban 後端持久化：新 `/me/kanban-cards` CRUD ＋ migration ＋ 取代 localStorage seed `KANBAN_CARDS`；牽涉 Layer B 具名/共享，另開 spec 寫明同意基礎與對外隔離。
- `QuickReview` 真功能（複盤練習）：待產品定義後另案。
