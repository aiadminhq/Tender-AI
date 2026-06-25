import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { designFeedback } from "./vite-plugin-design-feedback";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), designFeedback()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
