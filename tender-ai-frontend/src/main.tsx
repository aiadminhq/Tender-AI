import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { AuthProvider } from "@/store/auth-context";
import { AppProvider } from "@/store/app-context";
import { AppDataProvider } from "@/store/app-data";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <AppProvider>
        <AppDataProvider>
          <App />
        </AppDataProvider>
      </AppProvider>
    </AuthProvider>
  </StrictMode>,
);
