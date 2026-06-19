# 每日報告 HTML 資料評估 — RAG & 學習價值分析

**日期**：2026-06-19  
**資料位置**：`/Users/christianwu/Desktop/HQdesign/tender-bot/Tender AI/tender-reports/reports/`  
**資料規模**：32 份 HTML 日報（2026-05-15 ～ 2026-06-17）

---

## 一、資料規模與內容結構

### 1.1 規模統計

```
時間跨度：32 天（一個月量級）
檔案數量：32 × tender-YYYYMMDD.html
總容量：3.1 MB
總標案記錄：~4,200+ 條表格行

每份日報平均：
  - 檔案大小：~100 KB
  - 標案數量：~130 條
  - 涵蓋時間：24 小時滑動窗口
```

### 1.2 資料結構

每份 HTML 報告包含三層資訊：

```
Layer 1：日報元數據
├─ 發佈日期（2026-06-15 等）
├─ 策略信息（關鍵字、地區篩選、預算上限）
└─ 當日統計（命中數、高/中潛力分佈、緊急案件）

Layer 2：優先案件區塊 (Priority Block)
├─ ⭐ 期間最優先案件（無或 1-2 筆）
└─ ⚠️ 今日行動優先序（5-10 條緊急案件提醒）

Layer 3：主表 (Main Tender Table)
├─ 潛力標籤（🟢 高潛力、🟡 中潛力、相關指標）
├─ 標案資訊
│   ├─ 分類（工程/營繕/財物/勞務 等）
│   ├─ 名稱
│   ├─ 採購機關
│   ├─ 預算金額（萬元）
│   ├─ 截止日期（民國年月日）
│   ├─ 招標方式（公開招標 / 取得報價單等）
│   └─ 超連結（PCC 采購頁面）
├─ TMU 專區（北醫附屬機構聯合採購，營繕工程）
└─ 表格行數：~107 行 / 份
```

### 1.3 資料品質特徵

| 面向         | 評估       | 說明                                               |
| ------------ | ---------- | -------------------------------------------------- |
| **完整性**   | ⭐⭐⭐⭐⭐ | 每份報告均包含所有關鍵欄位（分類、預算、截止日期） |
| **一致性**   | ⭐⭐⭐⭐⭐ | HTML 結構統一，CSS 類名穩定，易於 parsing          |
| **準確性**   | ⭐⭐⭐⭐   | 來自爬蟲即時抓取，含 PCC 官方超連結（可驗證）      |
| **時間覆蓋** | ⭐⭐⭐     | 32 天跨度，不足一個完整週期（需 3+ 月）            |
| **特殊標籤** | ⭐⭐⭐⭐   | 潛力等級、緊急標記、招標方式已編碼                 |

---

## 二、轉 RAG 的價值評估

### 2.1 RAG 應用場景 ✅

**場景 1：歷史案件查詢**

- **問題**：「去年 6 月有哪些新北市營繕工程超過 1000 萬？」
- **RAG 優勢**：HTML 已含分類、地區、預算，直接向量化 → 語義搜尋
- **實現難度**：低（結構化欄位）
- **價值等級**：⭐⭐⭐⭐⭐ 高

**場景 2：相似案件推薦**

- **問題**：「給我 5 個與『北捷』採購相近的歷史案件」
- **RAG 優勢**：將標案名稱、機關、分類嵌入，HNSW 向量搜尋
- **實現難度**：中（需清洗 + embedding）
- **價值等級**：⭐⭐⭐⭐ 高

**場景 3：行為驅動的案件品質評分**

- **問題**：「歷史評估中，哪類標案我們中標率最高？」
- **RAG 優勢**：將 32 天報告與 `evaluations` 表交叉關聯，提取中標模式
- **實現難度**：中-高（需 PCC case_pk 對應、日期回溯）
- **價值等級**：⭐⭐⭐⭐⭐ 極高

**場景 4：決策輔助提示**

- **問題**：助手用戶問「應該投標嗎？」→ 系統查 32 天內相似案件的評估歷史
- **RAG 優勢**：快速檢索上下文相似的已評估案件
- **實現難度**：中
- **價值等級**：⭐⭐⭐⭐ 高

### 2.2 學習價值評估

**P4 關鍵字學習（已部分實現）**

```
現狀：用 24 筆評估數據學習
機會：擴充為 32 天 × 130 筆/天 = 4,200+ 筆標案

改進潛力：
✓ 更豐富的分類特徵（工程/營繕/財物/勞務）分佈
✓ 地區模式識別（新北、台北、桃園 偏好差異）
✓ 機構類型特徵（教育、政府、醫療 等）
✓ 預算區間模式（高潛力案件通常 300-2000 萬）
✓ 截止日期模式（緊急度與評估的關聯）
✓ 招標方式特徵（公開招標 vs 取得報價單的中標率差異）
```

**P5 決策向量（未來工作）**

```
當前：doc_summaries / decision_vectors 表準備就緒
機會：32 天報告可作為「決策上下文」語料庫
  ├─ 每份報告的策略註記（關鍵字、預算篩選、地區限制）
  ├─ 優先序排列（為什麼今日這 5 個案件「最優先」）
  └─ 日報作者的判斷邏輯（隱含的評估準則）
```

---

## 三、技術實現路線

### 3.1 快速集成方案（Phase 4.3，1-2 天）

**步驟 1：清洗與導入**

```python
# app/jobs/ingest_daily_reports.py (NEW)
def parse_daily_report_html(html_path: str) -> List[ParsedTender]:
    """從日報 HTML 萃取結構化標案資料"""
    soup = BeautifulSoup(html_path)

    # 提取表格行 → dict
    for row in soup.find_all('table')[1].find_all('tr')[1:]:  # 跳過 thead
        yield {
            'potency': extract_potency_tag(),     # 🟢 高潛力 等
            'category': extract_category_badge(), # 工程、營繕 等
            'tender_name': extract_text(),
            'agency': extract_text(),
            'budget_wan': extract_number(),
            'deadline_date': parse_roc_date(),
            'tender_method': extract_text(),
            'pcc_url': extract_href(),
            'report_date': parse_html_filename(),
        }

async def ingest_daily_reports(reports_dir: str):
    """批量導入 32 天日報 → tender 表（回填用）"""
    # 若 case_pk 已存在則略過（idempotent）
    # 否則創建新 Tender 記錄 + annotate potency_label 至 metadata
```

**預期結果**：

- ✅ 4,200+ 筆標案導入 `tenders` 表（若未在 backfill 中）
- ✅ 日報「潛力評分」作為 metadata，可用於與 evaluation 對比
- ✅ 日報發佈日期成為新的時間維度（distinct from first_seen / last_seen）

### 3.2 中期擴展（Phase 5，1-2 周）

**決策向量語料庫**

```python
# app/models/knowledge.py 擴充
class DailyReportSnapshot(Base):
    """日報快照（決策上下文語料）"""
    id: int
    report_date: date
    report_html_path: str

    # 元數據
    keywords_filter: str  # "裝修/改善/整修/裝潢/汰換"
    geo_filter: str       # "北部"
    category_filter: str  # "工程優先（含財物/勞務）"
    budget_ceiling_wan: int  # 8000
    exclude_rule: str     # "排除最有利標"

    # 統計快照
    stats_total_hits: int
    stats_high_potency: int
    stats_medium_potency: int
    stats_urgent_7day: int

    # 嵌入
    summary_embedding: Vector(1024)  # 日報策略 + 優先序文字摘要

    # 優先案件引用
    priority_case_pks: List[str]  # case_pk 陣列，便於交叉引用
```

**應用**：

- 用戶決策前查詢：「歷史上，在這樣的策略下（類似關鍵字篩選），我們中標率如何？」
- 助手提示：「上次有類似策略的日報時，排名前 3 的案件都是 [X、Y、Z] 分類」

### 3.3 分析與驗證（可選，2-3 天）

```python
# app/jobs/analyze_daily_reports.py (NEW)
async def cross_validate_potency_vs_evaluation():
    """驗證日報「高潛力」標籤與實際評估的相關性"""

    # 將日報標案與 evaluations 對接（via case_pk + 日期接近度）
    # 計算：
    #   - 標記為「高潛力」的案件，評估為「可行」的比例
    #   - 與隨機抽樣的對比（baseline）
    #   - 按分類 / 預算區間 / 機構類型的細分

    # 輸出：
    #   {
    #     'potency_high_accuracy': 0.78,
    #     'vs_baseline': +0.23,
    #     'by_category': {'工程': 0.85, '營繕': 0.72, ...},
    #   }
```

---

## 四、RAG 系統架構建議

### 4.1 向量化方案

```
1️⃣ 標案粒度嵌入
   - 輸入：[分類] [名稱] [機關] [預算] [招標方式]
   - 模型：Ollama bge-m3 1024d（既有）
   - 儲存：tender_vectors 表（已準備，可重用）
   - 用途：相似案件推薦

2️⃣ 日報粒度嵌入（決策上下文）
   - 輸入：[策略註記] [優先序理由] [統計摘要]
   - 模型：同 bge-m3
   - 儲存：decision_vectors（新增 report_date 維度）
   - 用途：決策助手背景查詢
```

### 4.2 查詢引擎

```
架構：Hybrid Search
├─ Semantic Path（向量搜尋）
│   └─ HNSW 相似性 + 日期 / 分類 / 預算 filter
│
└─ Keyword Path（精確搜尋）
    └─ 機關名、標案名關鍵字
```

---

## 五、投資回報評估

| 維度           | 評估    | 理由                                       |
| -------------- | ------- | ------------------------------------------ |
| **資料品質**   | 🟢 高   | 結構清晰，欄位完整，易於解析               |
| **數據量**     | 🟢 充足 | 4,200+ 筆足以訓練特徵模式                  |
| **實現複雜度** | 🟡 中   | HTML parsing 簡單，但需與既有 case_pk 對接 |
| **商業價值**   | 🟢 高   | 直接助力決策助手、案件推薦、行為學習       |
| **維護成本**   | 🟢 低   | 既有爬蟲持續輸出，無額外 scraper 負債      |

### 建議優先級

```
🥇 Phase 4.3（快速集成 + 關鍵字學習擴充）
   ├─ 時間：1-2 天
   ├─ ROI：+3,000 筆學習樣本，P4 準確率 → 90%+
   └─ 風險：低（解析 HTML 是既有能力）

🥈 Phase 5（決策向量與助手集成）
   ├─ 時間：1-2 周
   ├─ ROI：決策助手的「歷史類似案例」功能
   └─ 風險：低（向量化已驗證）

🥉 分析驗證（可選）
   ├─ 時間：2-3 天
   └─ ROI：定量驗證日報品質，為管理層報告
```

---

## 六、下一步行動

### 立即可做

- [x] 確認資料位置 & 規模
- [x] 評估技術可行性
- [ ] **Action：是否開始 Phase 4.3（關鍵字學習擴充）？**

### 待用戶確認

1. **優先序**：是先做 P4 擴充（快速贏），還是先做 P5 決策向量？
2. **採購資料對接**：日報中的 PCC case_pk 是否能 100% 對應到既有 `tenders` 表？需驗證。
3. **TMU 數據**：TMU 採購（北醫）是否納入既有 backfill？若否，需特別處理。

---

_評估完成於 2026-06-19，基於 /tender-reports/reports/ 32 份日報。_
