import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { firstVisibleHref, resolveWorkspaceModes, WORK_PRODUCT_MODES, type ProductMode } from "@agentforge/core/product-modes";
import { AppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ChatPage } from "@/src/pages/chat-page";
import { SettingsPage } from "@/components/settings-page";
import { UsagePage } from "@/components/usage-page";
import { WorkspacesPage } from "@/components/workspaces-page";
import { DocumentsStudio } from "@/components/documents-studio";
import { ResearchStudio } from "@/components/research-studio";
import { FinanceStudio } from "@/components/finance-studio";
import { DataStudio } from "@/components/data-studio";
import { ImagesStudio } from "@/components/images-studio";
import { VideosStudio } from "@/components/videos-studio";
import { PresentationsStudio } from "@/components/presentations-studio";
import { KnowledgePage } from "@/components/knowledge-page";
import { OnboardingScreen } from "@/components/onboarding-screen";
import { isElectron } from "@/lib/api-client";
import { useProductBrand } from "@/lib/product-brand";

function Shell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [workspaceName, setWorkspaceName] = useState("Home");
  const [visibleModes, setVisibleModes] = useState<ProductMode[]>([...WORK_PRODUCT_MODES]);

  const reload = useCallback(() => {
    void apiFetch("/api/v1/workspaces")
      .then((res) => res.json())
      .then((payload) => {
        const currentId = payload.currentWorkspaceId as string | undefined;
        const rows = (payload.workspaces ?? []) as Array<{
          id: string;
          name: string;
          productModes?: ProductMode[];
        }>;
        const current = rows.find((row) => row.id === currentId) ?? rows[0];
        setWorkspaceName(current?.name ?? "Home");
        setVisibleModes(resolveWorkspaceModes(current?.productModes));
      })
      .catch(() => {
        // first boot before SQLite is ready
      });
  }, []);

  useEffect(() => {
    reload();
    const onRefresh = () => reload();
    window.addEventListener("agentforge-shell-refresh", onRefresh);
    return () => window.removeEventListener("agentforge-shell-refresh", onRefresh);
  }, [reload, location.pathname]);

  return (
    <AppShell workspaceName={workspaceName} visibleModes={visibleModes}>
      {children}
    </AppShell>
  );
}

export function App() {
  const [gate, setGate] = useState<"loading" | "onboarding" | "app">("loading");
  const { productName } = useProductBrand();

  useEffect(() => {
    if (!isElectron()) {
      setGate("app");
      return;
    }
    try {
      if (window.localStorage.getItem("agentforge-offline-demo") === "1") {
        setGate("app");
        return;
      }
    } catch {
      // private mode
    }
    void apiFetch("/api/v1/settings")
      .then((res) => res.json())
      .then((payload) => {
        setGate(payload.hasOpenai ? "app" : "onboarding");
      })
      .catch(() => setGate("onboarding"));
  }, []);

  if (gate === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-app text-inkbase">
        <div className="flex w-[280px] flex-col items-center gap-4">
          <p className="font-heading text-[17px] font-semibold tracking-[.01em]">Starting {productName}…</p>
          <div className="h-0.5 w-full overflow-hidden bg-[color-mix(in_srgb,var(--color-text)_12%,transparent)]">
            <div className="h-full w-1/3 bg-accent" style={{ animation: "af-sweep 1.5s linear infinite" }} />
          </div>
        </div>
      </main>
    );
  }

  if (gate === "onboarding") {
    return (
      <OnboardingScreen
        onDone={() => setGate("app")}
        onOffline={() => {
          try {
            window.localStorage.setItem("agentforge-offline-demo", "1");
          } catch {
            // private mode
          }
          setGate("app");
        }}
      />
    );
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/workspaces" element={<WorkspacesPage />} />
        <Route path="/documents" element={<DocumentsStudio />} />
        <Route path="/research" element={<ResearchStudio />} />
        <Route path="/finance" element={<FinanceStudio />} />
        <Route path="/data" element={<DataStudio />} />
        <Route path="/images" element={<ImagesStudio />} />
        <Route path="/videos" element={<VideosStudio />} />
        <Route path="/presentations" element={<PresentationsStudio />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/studio/*" element={<Navigate to="/chat" replace />} />
        <Route path="/agents/*" element={<Navigate to="/chat" replace />} />
        <Route path="/workspace" element={<Navigate to="/chat" replace />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </Shell>
  );
}

function HomeRedirect() {
  return <Navigate to={firstVisibleHref([...WORK_PRODUCT_MODES])} replace />;
}
