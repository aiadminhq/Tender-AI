// 截圖工具（mock 示範資料）。
//
// 以 mock 模式（VITE_USE_API=false）建置 + 預覽，逐頁在桌面/行動、繁中/英文、
// 深/淺主題截圖，輸出到 screenshots/。截圖內容為「示範資料」，非真實 Layer A/B。
//
// 用法：
//   node scripts/screenshot.mjs                  # 全頁，桌面+行動，繁中，深色
//   node scripts/screenshot.mjs --route /swipe   # 只截某頁（可重複）
//   node scripts/screenshot.mjs --lang both --theme both --vp both
//
// 注意：不使用 dev-server.mjs（其路徑寫死 macOS）。改用 vite build + preview。
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "screenshots");
const PORT = 4188;
const BASE = `http://localhost:${PORT}`;

// ── CLI ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getMulti = (flag) =>
  argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
const getOne = (flag, def) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const ALL_ROUTES = [
  { path: "/", name: "dashboard" },
  { path: "/tenders", name: "tenders" },
  { path: "/tenders/t-001", name: "tender-detail" },
  { path: "/swipe", name: "swipe" },
  { path: "/insights", name: "insights" },
  { path: "/push", name: "push" },
  { path: "/assistant", name: "assistant" },
  { path: "/kanban", name: "kanban" },
  { path: "/rules", name: "rules" },
  { path: "/settings", name: "settings" },
];
const routeFilter = getMulti("--route");
const routes = routeFilter.length
  ? ALL_ROUTES.filter((r) => routeFilter.includes(r.path) || routeFilter.includes(r.name))
  : ALL_ROUTES;

const expand = (v, def, all) => (v === "both" ? all : [v ?? def]);
const viewports = expand(getOne("--vp"), "both", ["desktop", "mobile"]).flatMap((v) =>
  v === "both" ? ["desktop", "mobile"] : [v],
);
const langs = expand(getOne("--lang"), "zh", ["zh", "en"]);
const themes = expand(getOne("--theme"), "dark", ["dark", "light"]);

const VP = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

// ── helpers ──────────────────────────────────────────────────────────────
function sh(cmd, args, opts = {}) {
  return spawn(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
}
async function waitFor(url, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`server not ready: ${url}`);
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // 1) build (mock 模式) → preview
  console.log("• building (VITE_USE_API=false)…");
  await new Promise((res, rej) => {
    const b = sh("npx", ["vite", "build"], { env: { ...process.env, VITE_USE_API: "false" } });
    b.on("exit", (c) => (c === 0 ? res() : rej(new Error("build failed"))));
  });

  console.log("• starting preview…");
  const server = sh("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    env: { ...process.env, VITE_USE_API: "false" },
  });

  const browser = await chromium.launch();
  try {
    await waitFor(BASE);
    let n = 0;
    for (const theme of themes) {
      for (const lang of langs) {
        const ctx = await browser.newContext({ deviceScaleFactor: 2 });
        // 首次載入前寫入 localStorage（符合 pre-paint 腳本）。
        await ctx.addInitScript(
          ([t, l]) => {
            localStorage.setItem("tender-theme", t);
            localStorage.setItem("tender-lang", l === "en" ? "en" : "zh-Hant-TW");
          },
          [theme, lang],
        );
        const page = await ctx.newPage();
        for (const vp of viewports) {
          await page.setViewportSize(VP[vp]);
          for (const r of routes) {
            await page.goto(`${BASE}${r.path}`, { waitUntil: "networkidle" });
            await page.waitForTimeout(450); // SVG / 字體 settle
            const file = path.join(OUT, `${r.name}__${vp}__${lang}__${theme}.png`);
            await page.screenshot({ path: file, fullPage: true });
            n++;
            console.log(`  ✓ ${path.basename(file)}`);
          }
        }
        await ctx.close();
      }
    }
    console.log(`\n✓ ${n} screenshots → screenshots/`);
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
