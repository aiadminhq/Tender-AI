/**
 * Supabase 連線設定 —— 桌面版(main)與 PWA 共用的單一來源。
 *
 * 允許以環境變數覆寫(測試 / 分支專案)；預設指向正式專案。
 * 前綴優先序：中性的 `HQ_`(獨立版) → 相容舊 `GLAZE_`(桌面過渡期)。
 *
 * 註:PUBLISHABLE_KEY 為 Supabase 公開金鑰(受 RLS 保護),非機密;
 *    真正的機密為使用者 access_token,見 rest-client.ts 的安全性說明。
 */

function fromEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export const SUPABASE_URL =
  fromEnv("HQ_SUPABASE_URL", "GLAZE_SUPABASE_URL") ||
  "https://zsgjkcvgbfxqlihyxqbl.supabase.co";

export const PUBLISHABLE_KEY =
  fromEnv("HQ_SUPABASE_PUBLISHABLE_KEY", "GLAZE_SUPABASE_PUBLISHABLE_KEY") ||
  "sb_publishable_PFrNT0UcxVYaJ0ulpskOvg_fcPCMslj";
