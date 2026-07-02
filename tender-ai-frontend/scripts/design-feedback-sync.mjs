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

Fetches backend design-feedback summary and writes ../design-feedback/outbox/<target>/latest.md.`);
  process.exit(0);
}

const target = arg("target", "codex");
if (!SUPPORTED.has(target)) {
  console.error(`Unsupported target: ${target}`);
  console.error(`Supported: ${Array.from(SUPPORTED).join(", ")}`);
  process.exit(2);
}

const api = arg("api", process.env.VITE_API_BASE || "http://127.0.0.1:8000/api/v1");
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
const outDir = path.join(root, "design-feedback", "outbox", target);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "latest.md"), renderPrompt(target, markdown), "utf8");
fs.writeFileSync(path.join(outDir, "run.command.md"), renderRunbook(target), "utf8");

console.log(`Wrote design-feedback/outbox/${target}/latest.md (${data.count ?? 0} items)`);

function renderPrompt(cli, body) {
  return `# Design Feedback Backend Sync → ${cli}

PURPOSE: Aggregate design and UX feedback from backend records and turn it into scoped Tender AI improvements.
TASK: Read grouped feedback | map items to code paths | implement the smallest coherent fixes | verify relevant tests/build
MODE: write
CONTEXT: @tender-ai-frontend/src/**/* @tender-ai-backend/app/**/* @docs/design-feedback-workflow.md
EXPECTED: changed files, reasoning for each feedback item handled, verification results
CONSTRAINTS: preserve existing design language | do not touch unrelated WIP | avoid exposing Layer B details outside local/backend scope

${body}
`;
}

function renderRunbook(cli) {
  const ccwTools = new Set(["claude", "codex", "gemini", "opencode"]);
  const command = ccwTools.has(cli)
    ? `ccw cli --tool ${cli} --mode write --cd . -p "$(cat design-feedback/outbox/${cli}/latest.md)"`
    : `${cli} "$(cat design-feedback/outbox/${cli}/latest.md)"`;
  return `# Run ${cli} with backend-synced design feedback

\`\`\`bash
${command}
\`\`\`
`;
}
