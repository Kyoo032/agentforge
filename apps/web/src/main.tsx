import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { App } from "./App";
import { ProductBrandProvider } from "@/lib/product-brand";
import { HostCapabilitiesProvider } from "@/lib/host-capabilities";
import { isElectron } from "@/lib/api-client";
import "../app/globals.css";

const themeInit = () => {
  try {
    const stored = localStorage.getItem("agentforge-theme");
    const theme = stored === "light" || stored === "dark" ? stored : "light";
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
  } catch {
    // private mode: :root is already the light palette
  }
};
themeInit();

const Router = isElectron() ? HashRouter : BrowserRouter;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router>
      <ProductBrandProvider>
        {/* Phase 8: what this deployment can do, read once from `/api/v1/ping` and shared. */}
        <HostCapabilitiesProvider>
          <App />
        </HostCapabilitiesProvider>
      </ProductBrandProvider>
    </Router>
  </StrictMode>,
);
