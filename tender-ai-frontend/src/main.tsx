import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { AppProvider } from "@/store/app-context";
import { AppDataProvider } from "@/store/app-data";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <AppDataProvider>
        <App />
      </AppDataProvider>
    </AppProvider>
  </StrictMode>,
);
