# Tender AI

幫人篩選政府標案、並會「越用越聰明」的系統。Monorepo：

- `tender-ai-backend/` — 資料與 AI 大腦（Python / FastAPI / PostgreSQL + pgvector / Ollama）。
- `tender-ai-frontend/` — 人看的畫面（React / TypeScript / Vite，i18n 繁中預設、可切英文）。

## 產品方向：三階段路線圖

**選對案 → 備好標 → 送得出**，一條價值階梯，每階複用前一階的資料與學習：

| 階段               | 一句話                                     | 狀態                       |
| ------------------ | ------------------------------------------ | -------------------------- |
| **Phase 1 選對案** | 挑案＋推播＋習慣學習                       | 現況，幾近完成（收尾驗收） |
| **Phase 2 備好標** | 公司知識庫＋輔助把投標基礎資料備到 60–80%  | 規劃中                     |
| **Phase 3 送得出** | 半自動人機協作填入投標網站（送出必為人工） | 規劃中                     |

完整設計：[`docs/superpowers/specs/2026-06-27-three-phase-product-roadmap-design.md`](docs/superpowers/specs/2026-06-27-three-phase-product-roadmap-design.md)

## 文件入口

| 想知道                                     | 看哪裡                                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 所有 agent 須知（最高層約定）              | [`CLAUDE.md`](CLAUDE.md)                                                                                                                             |
| 產品需求與里程碑                           | [`PRD.md`](PRD.md)                                                                                                                                   |
| 三階段巨觀路線圖                           | [`docs/superpowers/specs/2026-06-27-three-phase-product-roadmap-design.md`](docs/superpowers/specs/2026-06-27-three-phase-product-roadmap-design.md) |
| 治理規範（資料三層、雲端開發、命名、發佈） | [`docs/governance/`](docs/governance/)                                                                                                               |
| 各功能設計規格                             | [`docs/superpowers/specs/`](docs/superpowers/specs/)                                                                                                 |
| 設計／願景                                 | [`DESIGN.md`](DESIGN.md)                                                                                                                             |

## 資料分層（揭露邊界）

| 層  | 白話                             | 邊界                                                     |
| --- | -------------------------------- | -------------------------------------------------------- |
| A   | 公開標案資料                     | 可公開                                                   |
| B   | 同事行為與想法                   | 白名單(@hqdesign.tw)內共享＋具名、對外永不揭露（需同意） |
| C   | 學出的知識（向量/權重/理由）     | 衍生物可重算；對外去識別化                               |
| D   | 公司資產／投標素材（Phase 2 起） | 公司機密；白名單內使用、對外永不揭露、永不進公開 repo    |

> ⚠️ Layer B/D 為機密，永不進公開版控與 GitHub Pages；對外發佈一律去識別化。詳見 [`CLAUDE.md`](CLAUDE.md) 與 [`docs/governance/04-訓練資料規範.md`](docs/governance/04-訓練資料規範.md)。

## 開發

- 在指定的 `claude/<主題>` 分支開發；未經同意不推別的分支、不開 PR。
- Conventional Commits ＋ 範圍標籤（`be`/`fe`/`data`/`infra`/`docs`）。
