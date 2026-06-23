# 方案 C：PCC 詳情附件轉檔 pipeline（轉檔）

> 把 PCC 詳情頁解析出的附件（PDF / DOCX / ODT / ZIP / 純文字）下載並抽成純文字，
> 供 enrich / embedding 使用。Layer A 公開資料；衍生純文字可重生。

## 1. 方案總覽

| 階段                                          | 既有元件                                | 本方案新增                        |
| --------------------------------------------- | --------------------------------------- | --------------------------------- |
| 解析詳情頁附件清單 `[{filename, url}]`        | `detail_parser._parse_attachments`      | —                                 |
| 下載附件落地（實檔 + `storage_uri`/`sha256`） | `services/archiver.archive_attachments` | —                                 |
| **附件位元組 → 純文字**                       | —                                       | **`jobs/convert_attachments.py`** |

新模組**接在 archiver 之後**（或獨立下載），核心是純函式
`convert_attachment_bytes(filename, content_type, data) -> dict`，回傳
`{filename, kind, text, char_count, error}`（ZIP 另含 `children`）。

下載一律重用 `_pcc_http.governed_get` + `pcc_session`（SkipSSLAdapter + 瀏覽器 UA +
逾時重試），**不自建 session 規避受治理連線**。

### 公開 API

- `convert_attachment_bytes(filename, content_type, data)` — 純函式核心（不連網）。
- `download_and_convert(attachment, *, session, getter, max_bytes)` — 下載 + 轉換（連網；getter 可注入離線測試）。
- `convert_attachments(attachments, *, session, getter)` — 整批；逐筆失敗隔離。
- `detect_kind(filename, content_type)` — 副檔名優先、Content-Type 後備的路由判斷。
- 各格式：`extract_pdf` / `extract_docx` / `extract_odt` / `extract_text_plain`。
- CLI：`python -m app.jobs.convert_attachments --url <URL>` 或 `--file <本地檔>`。

## 2. 相依套件清單

| 格式          | 解析方式                                                  | 相依           | 安裝狀態     |
| ------------- | --------------------------------------------------------- | -------------- | ------------ |
| DOCX          | 標準庫 `zipfile` 解 `word/document.xml`，串接 `<w:t>`     | **零額外相依** | 內建         |
| ODT           | 標準庫 `zipfile` 解 `content.xml`，串接 `text:p`/`text:h` | **零額外相依** | 內建         |
| ZIP           | 標準庫 `zipfile` 遞迴                                     | **零額外相依** | 內建         |
| 純文字        | UTF-8 → Big5 → CP950 → latin-1 後備解碼                   | **零額外相依** | 內建         |
| PDF           | `pypdf`（優先）→ `pdfminer.six`（後備），lazy import      | **需安裝其一** | **尚未安裝** |
| DOC（舊 OLE） | 不支援（記 error 略過）                                   | —              | —            |

**待辦：PDF 相依需擇一加入 `pyproject.toml`**（建議 `pypdf>=4`，純 Python、輕量、
維護活躍）。目前環境兩者皆未裝；程式碼遇 PDF 而無套件時記 `ImportError` error，
其他格式不受影響。離線測試以 monkeypatch `extract_pdf` 驗證路由，**不要求安裝**。

```toml
# pyproject.toml [project].dependencies 建議新增：
"pypdf>=4.0",
```

## 3. 各格式轉檔器選型理由

- **DOCX / ODT / ZIP 走標準庫**：兩者本質都是 zip+XML，用 `zipfile` + `ElementTree`
  即可穩定抽段落文字，**避免再引入 python-docx / odfpy 兩個相依**，符合「重型套件
  lazy import、測試離線可跑」的鐵則，且 CI 完全不需額外安裝。
- **PDF 走 pypdf 優先、pdfminer.six 後備**：PDF 無標準庫解法。pypdf 純 Python、體積小；
  pdfminer.six 抽取較完整但較重，作後備。兩者皆 lazy import，未安裝不影響其他格式。
- **DOC（舊版二進位 OLE）刻意不支援**：純標準庫無可靠解法（需 antiword/LibreOffice
  外部工具），記 `error` 略過，避免引入重相依或外部執行檔。PCC 投標須知多為 PDF/ODT，
  舊 .doc 罕見，先標記不支援、留待需求驗證。

## 4. 附件文字應落到哪個欄位（提案，未動 schema）

`tender_revisions.attachments`（JSONB）目前每筆為 archiver 結果
`{url, filename, storage_uri, sha256, skipped, error}`。建議：

### 方案 4A（推薦，**免 migration**）：擴充現有 `attachments` JSONB 元素

轉檔後在每筆附件 dict 補上 `text` / `char_count` / `text_error`（或巢狀 `convert: {...}`）。
JSONB 為 schema-less，**不需 migration**，只需 enrich job 在 archiver 之後呼叫
`convert_attachments` 並把結果 merge 進 `attachments[*]`。

- 優點：零 schema 變更、與既有附件索引同處、前端 `AttachmentItem` 可漸進加欄位。
- 缺點：大段文字塞進 revision JSONB（單案附件文字可能數十~數百 KB）。建議
  `text` 設字數上限（已內建 `MAX_TEXT_CHARS`），或只存 `char_count` + 把全文另落
  `data/downloads/.../<file>.txt`（沿用 archiver 的離庫模式），JSONB 僅存路徑。

### 方案 4B（embedding 導向，**需 migration**，先不做）

新增 `attachment_texts` 或 `doc_chunks` 表（`revision_id` FK、`source_uri`、`text`、
`char_count`、`sha256`），供 chunk + embedding。與既有 `knowledge_chunks` /
`tender_vectors`（Layer C）銜接較自然，但屬下一階段「embedding pipeline」範疇。

**結論**：本階段先交付「位元組 → 文字」純函式 + 下載整合，**不擅自 migration**。
落點建議採 4A（JSONB merge，全文離庫、JSONB 存 char_count + 路徑）；待 embedding
需求確定再評估 4B。掛入點：`enrich_details._process_one` / `research_enrich._process_one`
於 `archived = archiver(...)` 之後、組 `revision.attachments` 之前，
呼叫 `convert_attachments` 或對已落地檔讀 bytes 後 `convert_attachment_bytes`。

## 5. 安全

- **單檔大小上限** `MAX_BYTES`（30 MiB）：下載後與轉換前雙重檢查，超限記 error 不處理。
- **抽出文字上限** `MAX_TEXT_CHARS`（2,000,000 字）：防巨量純文字撐爆記憶體 / JSONB。
- **ZIP zip-bomb 防護**（跨整個 ZIP 樹共享 budget）：
  - `ZIP_MAX_TOTAL_BYTES`（200 MiB）解壓總量上限，**先看 `info.file_size` 宣告大小**
    再決定是否讀入，避免先吃記憶體。
  - `ZIP_MAX_ENTRIES`（500）內含檔數上限。
  - `ZIP_MAX_DEPTH`（3）巢狀 ZIP 遞迴層數上限，防遞迴炸彈。
- **單檔失敗隔離**：每個附件 / ZIP 內每個檔 try/except，記 `error`，不影響其他。
- **惡意檔**：僅做文字抽取（不執行巨集、不解析外部實體）；`ElementTree` 對 XML 外部
  實體預設不展開（Python 3.12 `xml.etree` 不處理 DTD/外部實體），降低 XXE 風險。
- **路徑安全**：本模組不寫檔（落地由 archiver 負責，其已消毒路徑）；ZIP 內檔名僅作
  標籤，不據以寫入檔案系統，無 zip-slip 風險。

## 6. 測試

`tests/test_convert_attachments.py`（25 例，**不連網**，`uv run pytest
tests/test_convert_attachments.py`）：

- 路由：副檔名 / Content-Type / unknown / 舊 .doc 不支援。
- 抽取：DOCX / ODT（標準庫自製最小檔）、純文字 Big5 後備、PDF（monkeypatch `extract_pdf`）。
- 邊界 / 安全：空內容、unknown、單檔大小上限、文字字數上限。
- ZIP：遞迴彙整、單檔失敗隔離、檔數上限、總量上限、巢狀深度上限。
- 下載：假 getter（`download_and_convert` / `convert_attachments` / 失敗隔離 /
  大小上限 / 缺 url）。

## 7. 未驗證項

- **PDF 實際抽取品質**：尚未安裝 pypdf/pdfminer，未對真實 PCC PDF 投標須知驗證抽取
  完整度（掃描影像型 PDF 無文字層 → 需 OCR，本階段不涵蓋）。
- **真實附件下載**：未在能連 PCC 的環境跑 `download_and_convert` 對真實附件
  端點（受治理 HTTP 行為、Content-Disposition / Content-Type 真實值）。
- **與 enrich job 的整合掛入點尚未實作**（本交付僅 pipeline 本身 + 落點提案）。
- **ODT/DOCX 表格 / 頁首頁尾**：目前只抽段落（`w:p` / `text:p`/`text:h`）文字，
  表格 cell 文字會被 `itertext`（ODT）涵蓋，但 DOCX 表格僅靠 `<w:p>` iter（表格內
  段落仍會被 `root.iter` 抓到，已涵蓋），未針對複雜版面（文字框、註腳）特別處理。
