// Dev-only Vite plugin：接收前端標註層 POST 的 Markdown，append 到 monorepo 根的
// design-feedback/inbox.md，讓 Claude Code CLI 直接讀到「指向哪個元件、想怎麼改」的回饋。
//
// 僅在 dev server（configureServer）掛載；正式 build 不含此端點。

import fs from "node:fs";
import path from "node:path";
import type { Connect, Plugin, ViteDevServer } from "vite";

const ENDPOINT = "/__design-feedback";

export interface DesignFeedbackOptions {
  /** inbox.md 的絕對或相對（相對 vite root）路徑。預設：monorepo 根/design-feedback/inbox.md */
  outFile?: string;
}

interface FeedbackPayload {
  markdown?: string;
  annotations?: unknown[];
  targetCli?: string | null;
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
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
