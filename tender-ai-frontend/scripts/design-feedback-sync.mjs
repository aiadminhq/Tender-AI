import fs from "node:fs";
import path from "node:path";

const SUPPORTED = new Set([
  "claude",
  "codex",
  "hermes",
  "opencode",
  "antigravity",
  "gemini",
]);

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? (process.argv[idx + 1] ?? fallback) : fallback;
}

if (process.argv.includes("--help")) {
  console.log(`Usage:
node scripts/design-feedback-sync.mjs --target codex [--api http://127.0.0.1:8000/api/v1] [--limit 100]

Fetches backend design-feedback summary and writes ../design-feedback/handoffs/<target>/latest.md.
The result is a manual handoff prompt; this script never starts a CLI.`);
  process.exit(0);
}

const target = arg("target", "codex");
if (!SUPPORTED.has(target)) {
  console.error(`Unsupported target: ${target}`);
  console.error(`Supported: ${Array.from(SUPPORTED).join(", ")}`);
  process.exit(2);
}

const api = arg(
  "api",
  process.env.VITE_API_BASE || "http://127.0.0.1:8000/api/v1",
);
const limit = arg("limit", "100");
const url = new URL(`${api.replace(/\/$/, "")}/design-feedback/summary`);
url.searchParams.set("target_cli", target);
url.searchParams.set("limit", limit);

const res = await fetch(url);
if (!res.ok) {
  console.error(`Failed to fetch design feedback summary: ${res.status}`);
  process.exit(1);
}

const data = await res.json();
const markdown = typeof data.markdown === "string" ? data.markdown : "";
const root = path.resolve(import.meta.dirname, "..", "..");
const outDir = path.join(root, "design-feedback", "handoffs", target);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "latest.md"),
  renderPrompt(target, markdown),
  "utf8",
);

console.log(
  `Wrote design-feedback/handoffs/${target}/latest.md (${data.count ?? 0} items)`,
);

function renderPrompt(cli, body) {
  return `# Tender AI 設計回饋交接 → ${cli}

此為人工遞交提示詞。請先檢閱後自行貼入目標工具；不要啟動或控制其他 CLI，也不要自行擴大工作範圍。

PURPOSE: 將後端彙整的設計與 UX 回饋收斂為具範圍、可驗證的 Tender AI 改動。
TASK: 閱讀分組回饋 | 對照元件與資料欄位 | 實作最小必要修正 | 執行相關 build／tests | 回報處理結果
MODE: write
CONTEXT: @tender-ai-frontend/src/**/* @tender-ai-backend/app/**/* @docs/design-feedback-workflow.md
EXPECTED: 變更檔案、每則回饋的處理理由、驗證結果，以及未處理的阻礙（若有）
CONSTRAINTS: 保留既有設計語言 | 不碰無關 WIP | 不要自動 stage 或 commit | 不要暴露 local／backend 範圍以外的 Layer B 細節

${body}
`;
}
