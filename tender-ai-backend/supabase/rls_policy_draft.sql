-- ============================================================================
-- Tender AI — RLS Policy 草稿（32 張 public 表）
-- 日期：2026-07-04（草擬）／2026-07-06（套用）
-- 狀態：★ 已套用 ★ — 2026-07-06 經 owner 核可，以 migration
--       `enable_rls_all_tables_layer_a_read` 套用至雲端專案 ajltwjkegmbzethwgbje；
--       31 個 rls_disabled_in_public ERROR 全數消除，並以 anon role 實測驗證
--       （Layer A 可讀、Layer B/C deny-all、postgres owner 不受影響）。
--       本檔保留為 policy 全文與回退腳本的單一事實來源。
--
-- 目的：消除 Supabase security advisor 的 31 個 rls_disabled_in_public ERROR，
--       並落實資料三層邊界（CLAUDE.md）：
--         Layer A（公開標案資料）→ 唯讀開放給 anon/authenticated
--         Layer B（同事行為/想法）→ 僅 service_role／後端可讀寫，對外 deny-all
--         Layer C（學習衍生物）  → 對外 deny-all（對外揭露須另行去識別化）
--
-- 安全性論證（2026-07-04 已對雲端專案 ajltwjkegmbzethwgbje 實查驗證）：
--   1. 全部 32 張表 owner = postgres，且 pg_roles.rolbypassrls = true
--      → Railway 後端以 postgres.<ref> 連線，開 RLS 後完全不受影響。
--   2. service_role 天生 BYPASSRLS → Supabase Dashboard / MCP 操作不受影響。
--   3. 前端從不使用 supabase-js / anon key（所有流量走 FastAPI）
--      → 開 RLS 對現有功能零破壞，只封鎖「拿 anon key 直打 PostgREST」的路徑。
--   4. 「ENABLE RLS 且不建任何 policy」= 對 anon/authenticated deny-all，
--      這是 Layer B/C 表的預期狀態，不是漏設。
--
-- 刻意保守的兩個決定（可再討論）：
--   * knowledge_chunks、doc_summaries 雖偏 Layer A/C，但可能含公司內部
--     知識文件內容 → 先歸入「不開放」，之後確認內容純公開再放寬。
--   * assistant_brain_config 含 BYOK 大腦設定 → 絕對不開放。
--
-- 另有 1 個 WARN（vector extension 裝在 public schema）不在本檔處理範圍，
-- 搬移 extension 動作大、風險高，建議先擱置。
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 第 1 部分：全部 32 張表開啟 RLS
-- （開啟後預設 deny-all；下方第 2 部分再對 Layer A 開唯讀）
-- ----------------------------------------------------------------------------

-- Layer A：公開標案資料（後續開唯讀）
ALTER TABLE public.tenders                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_tender                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_runs                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tender_snapshots               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tender_revisions               ENABLE ROW LEVEL SECURITY;

-- Layer B：同事行為/想法（deny-all，僅後端/service_role）
ALTER TABLE public.users                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluations                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annotations                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_searches                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shares                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tender_user_state              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preference_profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_keyword_weights           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_manual_keywords           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_threads              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_brain_config         ENABLE ROW LEVEL SECURITY;  -- 含 BYOK 設定，絕不開放
ALTER TABLE public.push_logs                      ENABLE ROW LEVEL SECURITY;

-- Layer C：學習衍生物（deny-all；對外揭露須另行去識別化）
ALTER TABLE public.tender_vectors                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_vectors               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keyword_weights                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keyword_weight_revisions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tier_threshold_revisions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_logs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks               ENABLE ROW LEVEL SECURITY;  -- 可能含內部知識，暫不開放
ALTER TABLE public.doc_summaries                  ENABLE ROW LEVEL SECURITY;  -- 同上，暫不開放

-- 基礎設施/維運表（deny-all）
ALTER TABLE public.alembic_version                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crawl_runs                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crawl_failures                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detail_field_visibility_config ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 第 2 部分：Layer A 六張表開放唯讀（SELECT only）
-- 對象：anon + authenticated（PostgREST 路徑）
-- 注意：只開 SELECT；INSERT/UPDATE/DELETE 仍 deny-all，寫入只能走後端。
-- ----------------------------------------------------------------------------

CREATE POLICY tenders_public_read          ON public.tenders          FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY daily_tender_public_read     ON public.daily_tender     FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY daily_runs_public_read       ON public.daily_runs       FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY sources_public_read          ON public.sources          FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY tender_snapshots_public_read ON public.tender_snapshots FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY tender_revisions_public_read ON public.tender_revisions FOR SELECT TO anon, authenticated USING (true);

COMMIT;

-- ============================================================================
-- 回退（如需撤銷，整段執行即可，冪等）：
--
-- BEGIN;
-- DROP POLICY IF EXISTS tenders_public_read          ON public.tenders;
-- DROP POLICY IF EXISTS daily_tender_public_read     ON public.daily_tender;
-- DROP POLICY IF EXISTS daily_runs_public_read       ON public.daily_runs;
-- DROP POLICY IF EXISTS sources_public_read          ON public.sources;
-- DROP POLICY IF EXISTS tender_snapshots_public_read ON public.tender_snapshots;
-- DROP POLICY IF EXISTS tender_revisions_public_read ON public.tender_revisions;
-- ALTER TABLE public.tenders                        DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.daily_tender                   DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.daily_runs                     DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.sources                        DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tender_snapshots               DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tender_revisions               DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.users                          DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.events                         DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.evaluations                    DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.annotations                    DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.saved_searches                 DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.shares                         DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tender_user_state              DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.preference_profiles            DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.user_keyword_weights           DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.user_manual_keywords           DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.assistant_threads              DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.assistant_messages             DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.assistant_brain_config         DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.push_logs                      DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tender_vectors                 DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.decision_vectors               DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.keyword_weights                DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.keyword_weight_revisions       DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tier_threshold_revisions       DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.evolution_logs                 DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.knowledge_chunks               DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.doc_summaries                  DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.alembic_version                DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.crawl_runs                     DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.crawl_failures                 DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.detail_field_visibility_config DISABLE ROW LEVEL SECURITY;
-- COMMIT;
-- ============================================================================
