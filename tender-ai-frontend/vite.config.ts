import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  // 防呆（root fix）：dev server（command==="serve"）下若環境殘留 NODE_ENV=production，
  // @vitejs/plugin-react 會把 skipFastRefresh 設為 true → 不注入 react-refresh preamble，
  // 但 oxc transform 仍往模組塞 $RefreshSig$() → ReferenceError → React 完全不 mount 的空白頁
  //（症狀像「樣式又變回舊版」，連帶 import.meta.env.DEV 變 false，dev-only 頁/工具全被關）。
  // 不論用什麼方式啟動（pnpm dev / pnpm exec vite / tmux 繼承的 env）都在此就地校正。
  if (command === "serve" && process.env.NODE_ENV === "production") {
    process.env.NODE_ENV = "development";
  }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    // 區網分享（讓同網段同事，如 David，連 http://<本機LAN-IP>:5173 操作本站）：
    // - host:true → 綁 0.0.0.0/[::]（原本只綁 [::1] loopback，區網不可達）。
    // - proxy → 前端走相對 /api，由 dev server 端代理回本機後端 127.0.0.1:8000。
    //   因此「後端與 Ollama 都不必對區網開埠、也不必改 CORS」，AI 算力全留在本機；
    //   區網上唯一對外的只有這個 Vite dev server。用完關掉即收回。
    server: {
      host: true,
      proxy: {
        "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      },
    },
  };
});
