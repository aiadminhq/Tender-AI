// 臨時驗證腳本：對「vite dev（DEV=true）」驗證 design-system 頁與全站標註層。
// 用法：先 `VITE_USE_API=false npx vite --port 5191 --strictPort`，再 `node scripts/verify-annotate.mjs`
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "screenshots", "verify");
const BASE = "http://localhost:5191";
const log = (...a) => console.log(...a);
const fail = (m) => {
  console.error("✗ " + m);
  process.exitCode = 1;
};

const browser = await chromium.launch();
try {
  await mkdir(OUT, { recursive: true });
  const ctx = await browser.newContext({ deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    localStorage.setItem("tender-theme", "dark");
    localStorage.setItem("tender-lang", "zh-Hant-TW");
    localStorage.removeItem("tender-ai:design-feedback");
    localStorage.removeItem("tender:auth-user");
    localStorage.removeItem("tender:auth-token");
    // 跳過小助手首訪導覽（z-[60] 全螢幕遮罩會攔截點擊）。
    localStorage.setItem("tender-assistant-onboarded", "1");
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console.error]", m.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  // 先明確走 dev-only 示範模式；直接種快取 user 會被 fail-closed Auth 正確登出。
  await page.route("**/api/v1/auth/login", (route) => route.abort());
  await page.goto(`${BASE}/design-system`, { waitUntil: "networkidle" });
  await page.getByLabel("公司信箱").fill("verify@hqdesign.tw");
  await page.getByLabel("密碼").fill("not-a-real-password");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await page.getByRole("button", { name: "改用示範模式（離線瀏覽）" }).click();
  await page.waitForTimeout(200);

  // 1) design-system 頁渲染 + dev toggle 出現
  await page.waitForTimeout(500);
  const heading = await page.locator("h1", { hasText: "設計系統" }).count();
  heading
    ? log("✓ /design-system 標題渲染")
    : fail("/design-system 標題未渲染");

  const tokenSwatch = await page.locator('[data-ds^="token:"]').count();
  tokenSwatch > 0
    ? log(`✓ token 區渲染（${tokenSwatch} 個 data-ds token）`)
    : fail("token 區未渲染");

  const dsComponents = await page
    .locator('[data-ds="Button"], [data-ds="Badge"], [data-ds="Card"]')
    .count();
  dsComponents >= 3
    ? log(`✓ 元件藝廊渲染（Button/Badge/Card）`)
    : fail("元件藝廊缺漏");

  const toggle = page.locator("button[data-annotate-ui][aria-pressed]");
  (await toggle.count())
    ? log("✓ topbar 標註 toggle 出現（dev-gated）")
    : fail("topbar 標註 toggle 未出現");

  await page.screenshot({
    path: path.join(OUT, "design-system__dark.png"),
    fullPage: true,
  });

  // 2) 開啟標註 → 點某元件 → 彈窗 → 填寫 → 送出 → pin + dock 計數
  await toggle.first().click();
  await page.waitForTimeout(150);
  const pressed = await toggle.first().getAttribute("aria-pressed");
  pressed === "true"
    ? log("✓ 標註模式開啟（aria-pressed=true）")
    : fail("標註模式未開啟");

  // 點藝廊裡的 primary 按鈕（capture click 會被攔截、不會真的觸發）
  const targetBtn = page
    .locator('[data-ds="Button"] button', { hasText: "primary" })
    .first();
  await targetBtn.click({ force: true });
  await page.waitForTimeout(200);

  const panel = page.locator("[data-annotate-ui]").filter({ hasText: "建議" });
  const panelVisible = await page.locator("textarea").count();
  panelVisible ? log("✓ 點擊元件 → 彈窗出現（含輸入框）") : fail("彈窗未出現");

  await page.locator("textarea").first().fill("這顆主要按鈕的圓角想再小一點");
  // 嚴重度/類型 chips：點任一「重要」嚴重度（若存在）
  const importantChip = page.getByRole("button", { name: "重要" });
  if (await importantChip.count()) await importantChip.first().click();
  await page.screenshot({ path: path.join(OUT, "annotate-panel__dark.png") });

  // 送出
  const submit = page.getByRole("button", { name: /送出|新增|加入|儲存/ });
  if (await submit.count()) {
    await submit.first().click();
  } else {
    fail("找不到送出按鈕（檢查 i18n annSubmit 文案）");
  }
  await page.waitForTimeout(300);

  const pins = await page.locator("button[data-annotate-ui].fixed").count();
  pins > 0 ? log(`✓ 標註 pin 出現（${pins}）`) : log("· pin 數待確認");

  const dockText = await page
    .locator("[data-annotate-ui]")
    .filter({ hasText: "則" })
    .first()
    .innerText()
    .catch(() => "");
  log("  dock 文字：", dockText.replace(/\s+/g, " ").slice(0, 60));

  await page.screenshot({
    path: path.join(OUT, "annotate-after-submit__dark.png"),
    fullPage: true,
  });

  // 3) Codex 任務提示詞只會複製／下載，驗證按鈕與成功狀態，不會啟動 CLI 或寫檔。
  const targetSelect = page.locator("#annotation-export-target");
  if (await targetSelect.count()) await targetSelect.selectOption("codex");
  const exportBtn = page.getByRole("button", { name: /複製任務提示詞/ });
  if (await exportBtn.count()) {
    await exportBtn.first().click();
    await page.waitForTimeout(600);
    const status = await page
      .locator("[data-annotate-ui]")
      .filter({ hasText: /任務提示詞已(複製|下載)/ })
      .count();
    status
      ? log("✓ 已產生 Codex 任務提示詞（未自動啟動 CLI）")
      : fail("未顯示任務提示詞交接狀態");
  } else {
    fail("找不到複製任務提示詞按鈕");
  }

  // 4) 淺色主題截圖
  await page.evaluate(() => localStorage.setItem("tender-theme", "light"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(OUT, "design-system__light.png"),
    fullPage: true,
  });
  log("✓ 淺色主題截圖完成");

  await ctx.close();
} finally {
  await browser.close();
}
log(process.exitCode ? "\n✗ 驗證有失敗項" : "\n✓ 全部驗證通過");
