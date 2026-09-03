import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { App } from "./App";
import { ProductBrandProvider } from "@/lib/product-brand";
import { isElectron } from "@/lib/api-client";
import "../app/globals.css";

const themeInit = () => {
  try {
    if (localStorage.getItem("agentforge-theme") === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  } catch {
    // private mode
  }
};
themeInit();

const Router = isElectron() ? HashRouter : BrowserRouter;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router>
      <ProductBrandProvider>
        <App />
      </ProductBrandProvider>
    </Router>
  </StrictMode>,
);
