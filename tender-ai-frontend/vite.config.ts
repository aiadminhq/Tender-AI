import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { designFeedback } from "./vite-plugin-design-feedback";

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
    plugins: [react(), tailwindcss(), designFeedback()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
  };
});
