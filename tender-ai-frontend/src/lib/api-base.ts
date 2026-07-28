/**
 * Production 與 Vercel Python function 同源，固定走 `/api/v1`。
 * `VITE_API_BASE` 僅供本機與 preview 開發覆寫，避免舊 Railway URL 汙染 production bundle。
 */
export function resolveApiBase(
  isProduction: boolean,
  configured?: string,
): string {
  if (isProduction) return "/api/v1";
  return configured?.trim() || "/api/v1";
}

export const API_BASE = resolveApiBase(
  import.meta.env.PROD,
  import.meta.env.VITE_API_BASE as string | undefined,
);
