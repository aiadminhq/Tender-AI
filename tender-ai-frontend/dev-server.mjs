// Launcher for the Claude Preview MCP.
// The MCP spawns children with an inaccessible cwd (getcwd EPERM) and does NOT
// capture stdout, so we log to an absolute file path to diagnose failures.
import { appendFileSync } from "node:fs";

const root =
  "/Users/christianwu/Desktop/HQdesign/tender-bot/Tender AI/tender-ai-frontend";
const logPath = root + "/dev-server.log";
const log = (m) => {
  try {
    appendFileSync(logPath, `[${process.pid}] ${m}\n`);
  } catch {
    /* ignore */
  }
};

log("boot: launcher started");
try {
  log("cwd-before: trying process.cwd()");
  try {
    log("cwd-before=" + process.cwd());
  } catch (e) {
    log("cwd-before threw: " + e.message);
  }
  process.chdir(root);
  log("chdir ok -> " + root);

  const { createServer } = await import("vite");
  log("vite imported");
  const server = await createServer({
    root,
    configFile: root + "/vite.config.ts",
    server: { port: 5180, strictPort: true, host: "127.0.0.1" },
  });
  log("vite server created, listening...");
  await server.listen();
  log("LISTENING on 5180");
  server.printUrls();
} catch (e) {
  log("FATAL: " + (e && e.stack ? e.stack : String(e)));
  process.exit(1);
}
