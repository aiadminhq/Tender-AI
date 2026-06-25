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
          const { markdown } = JSON.parse(raw || "{}") as { markdown?: string };
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

          server.config.logger.info(
            `[design-feedback] 已寫入 ${path.relative(root, outFile)}`,
          );
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, path: outFile }));
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
