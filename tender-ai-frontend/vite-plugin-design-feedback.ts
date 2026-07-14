// Dev-only Vite plugin：接收前端標註層 POST 的 Markdown，append 到 monorepo 根的
// design-feedback/inbox.md，讓 Claude Code CLI 直接讀到「指向哪個元件、想怎麼改」的回饋。
//
// 僅在 dev server（configureServer）掛載；正式 build 不含此端點。

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ServerResponse } from "node:http";
import type { Connect, Plugin, ViteDevServer } from "vite";

const ENDPOINT = "/__design-feedback";
const DISPATCH_ENDPOINT = "/__design-feedback/dispatch";
const JOBS_ENDPOINT = "/__design-feedback/jobs/";
const DIRECT_CLI_TARGETS = new Set(["claude", "codex", "gemini", "opencode"]);
const MAX_MARKDOWN_BYTES = 120_000;

export interface DesignFeedbackOptions {
  /** inbox.md 的絕對或相對（相對 vite root）路徑。預設：monorepo 根/design-feedback/inbox.md */
  outFile?: string;
}

interface FeedbackPayload {
  markdown?: string;
  annotations?: unknown[];
  targetCli?: string | null;
}

type DispatchStatus = "queued" | "running" | "completed" | "failed";

interface DispatchJob {
  id: string;
  targetCli: string;
  status: DispatchStatus;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

const jobs = new Map<string, DispatchJob>();

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function isLocalRequest(req: Connect.IncomingMessage): boolean {
  const address = req.socket.remoteAddress;
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function createJobId(): string {
  return `df-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function designFeedback(options: DesignFeedbackOptions = {}): Plugin {
  return {
    name: "design-feedback",
    apply: "serve", // 只在 dev server 生效
    configureServer(server: ViteDevServer) {
      // vite root = tender-ai-frontend；預設往上一層寫到 monorepo 根。
      const root = server.config.root;
      const outFile = options.outFile
        ? path.resolve(root, options.outFile)
        : path.resolve(root, "..", "design-feedback", "inbox.md");
      const repoRoot = path.resolve(root, "..");

      server.middlewares.use(DISPATCH_ENDPOINT, async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
          return;
        }
        // Vite dev server may be shared on LAN. Only a browser on this machine may start a local CLI process.
        if (!isLocalRequest(req)) {
          sendJson(res, 403, { ok: false, error: "local development only" });
          return;
        }

        try {
          const raw = await readBody(req);
          const { markdown, targetCli } = JSON.parse(raw || "{}") as FeedbackPayload;
          if (!markdown || typeof markdown !== "string") {
            sendJson(res, 400, { ok: false, error: "missing markdown" });
            return;
          }
          if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) {
            sendJson(res, 413, { ok: false, error: "feedback payload too large" });
            return;
          }
          if (!targetCli || !DIRECT_CLI_TARGETS.has(targetCli)) {
            sendJson(res, 400, { ok: false, error: "unsupported local CLI target" });
            return;
          }

          const id = createJobId();
          const job: DispatchJob = {
            id,
            targetCli,
            status: "queued",
            createdAt: new Date().toISOString(),
          };
          jobs.set(id, job);

          const prompt = renderCliPrompt(targetCli, markdown);
          const child = spawn(
            process.env.CCW_BIN || "ccw",
            ["cli", "--tool", targetCli, "--mode", "write", "--cd", repoRoot, "-p", prompt],
            { cwd: repoRoot, stdio: "ignore", windowsHide: true },
          );
          job.status = "running";

          child.once("error", () => {
            job.status = "failed";
            job.error = "本機 CLI 無法啟動";
            job.completedAt = new Date().toISOString();
          });
          child.once("close", (code) => {
            job.status = code === 0 ? "completed" : "failed";
            job.error = code === 0 ? undefined : "本機 CLI 執行未完成";
            job.completedAt = new Date().toISOString();
          });

          server.config.logger.info(
            `[design-feedback] 已直接送至 ${targetCli} CLI（${id}）`,
          );
          sendJson(res, 202, { ok: true, job: { id, targetCli, status: job.status } });
        } catch {
          sendJson(res, 500, { ok: false, error: "local CLI dispatch failed" });
        }
      });

      server.middlewares.use(JOBS_ENDPOINT, (req, res) => {
        if (req.method !== "GET") {
          sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
          return;
        }
        if (!isLocalRequest(req)) {
          sendJson(res, 403, { ok: false, error: "local development only" });
          return;
        }
        const id = req.url?.replace(/^\//, "").split("?")[0] ?? "";
        const job = jobs.get(id);
        if (!job) {
          sendJson(res, 404, { ok: false, error: "job not found" });
          return;
        }
        sendJson(res, 200, { ok: true, job });
      });

      server.middlewares.use(ENDPOINT, async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method Not Allowed");
          return;
        }
        try {
          const raw = await readBody(req);
          const { markdown, targetCli } = JSON.parse(raw || "{}") as FeedbackPayload;
          if (!markdown || typeof markdown !== "string") {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "missing markdown" }));
            return;
          }

          fs.mkdirSync(path.dirname(outFile), { recursive: true });
          const exists = fs.existsSync(outFile);
          const header = exists
            ? "\n\n---\n\n"
            : "# 設計回饋 inbox\n\n> 由前端標註工具自動寫入；Claude Code CLI 讀此檔取得介面優化指示。\n\n---\n\n";
          fs.appendFileSync(outFile, header + markdown, "utf8");
          let cliPath: string | null = null;
          if (targetCli && /^[a-z0-9_-]+$/i.test(targetCli)) {
            cliPath = writeCliOutbox(root, targetCli, markdown);
          }

          server.config.logger.info(
            `[design-feedback] 已寫入 ${path.relative(root, outFile)}`,
          );
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, path: outFile, cliPath }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }
      });
    },
  };
}

function writeCliOutbox(root: string, targetCli: string, markdown: string): string {
  const dir = path.resolve(root, "..", "design-feedback", "outbox", targetCli);
  fs.mkdirSync(dir, { recursive: true });
  const latest = path.join(dir, "latest.md");
  const prompt = renderCliPrompt(targetCli, markdown);
  fs.writeFileSync(latest, prompt, "utf8");
  fs.writeFileSync(path.join(dir, "run.command.md"), renderRunbook(targetCli, latest), "utf8");
  return latest;
}

function renderCliPrompt(targetCli: string, markdown: string): string {
  return `# Design Feedback Handoff → ${targetCli}

PURPOSE: Use the collected UI/UX feedback to identify concrete implementation improvements in Tender AI; success = scoped, testable changes aligned with existing design system.
TASK: Read each feedback item | map it to current frontend/backend files | propose or implement the smallest coherent fix | verify build/tests relevant to touched files
MODE: write
CONTEXT: @tender-ai-frontend/src/**/* @tender-ai-backend/app/**/* @design-feedback/inbox.md
EXPECTED: concise implementation notes, changed files, verification commands and results
CONSTRAINTS: preserve existing design language | do not touch unrelated WIP | only stage files from this task if committing

${markdown}
`;
}

function renderRunbook(targetCli: string, latest: string): string {
  const rel = path.relative(path.resolve(path.dirname(latest), "..", "..", ".."), latest);
  const ccwTools = new Set(["claude", "codex", "gemini", "opencode"]);
  const command = ccwTools.has(targetCli)
    ? `ccw cli --tool ${targetCli} --mode write --cd . -p "$(cat ${rel})"`
    : `${targetCli} "$(cat ${rel})"`;
  return `# Run ${targetCli} with the latest design feedback

\`\`\`bash
${command}
\`\`\`
`;
}
