import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  firstVisibleHref,
  resolveWorkspaceModes,
  WORK_PRODUCT_MODES,
  type ProductMode,
} from "@agentforge/core/product-modes";
import { HOME_WORKSPACE_NAME } from "@agentforge/core/local-owner";
import { AppShell } from "@/components/app-shell";
import { ComponentSetupSilent } from "@/components/component-setup";
import { apiFetch } from "@/lib/api-client";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { SettingsPage } from "@/components/settings-page";
import { UsagePage } from "@/components/usage-page";
import { WorkspacesPage } from "@/components/workspaces-page";
import { KnowledgePage } from "@/components/knowledge-page";
import { WorkModeKeepAlive } from "@/components/work-mode-keep-alive";
import { OnboardingScreen } from "@/components/onboarding-screen";
import { isElectron } from "@/lib/api-client";
import {
  GATE_EVENT,
  parseGatewayGate,
  readGateEvent,
  resolveGate,
  type GatewayGatePayload,
  type GateView,
} from "@/lib/gateway-gate";
import { applyLocale, freezeLocale, LOCALE_RESTART_EVENT, t } from "@/lib/i18n";
import { useProductBrand } from "@/lib/product-brand";
import { WorkspaceScope } from "@/lib/workspace-scope";

function Shell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState(HOME_WORKSPACE_NAME);
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
        setWorkspaceId(current?.id ?? null);
        setWorkspaceName(current?.name ?? HOME_WORKSPACE_NAME);
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
    <WorkspaceScope.Provider value={{ id: workspaceId, name: workspaceName }}>
      <AppShell workspaceName={workspaceName} visibleModes={visibleModes}>
        {children}
      </AppShell>
    </WorkspaceScope.Provider>
  );
}

export function App() {
  const [gate, setGate] = useState<GateView | "loading">("loading");
  const [gateway, setGateway] = useState<GatewayGatePayload | null>(null);
  const [localeEpoch, setLocaleEpoch] = useState(0);
  const { productName } = useProductBrand();

  useEffect(() => {
    const onRestart = () => setLocaleEpoch((n) => n + 1);
    window.addEventListener(LOCALE_RESTART_EVENT, onRestart);
    return () => window.removeEventListener(LOCALE_RESTART_EVENT, onRestart);
  }, []);

  // Settings can hand the app a gate the host just reported (sign out of the
  // gateway). The host still decides; this only re-renders its answer.
  useEffect(() => {
    const onGate = (event: Event) => {
      const reported = readGateEvent(event);
      setGateway(reported);
      setGate(resolveGate(reported, isElectron()));
    };
    window.addEventListener(GATE_EVENT, onGate);
    return () => window.removeEventListener(GATE_EVENT, onGate);
  }, []);

  useEffect(() => {
    void apiFetch("/api/v1/settings")
      .then((res) => res.json())
      .then((payload) => {
        if (localeEpoch === 0) {
          freezeLocale(payload.locale);
        } else {
          applyLocale(payload.locale);
        }
        // The host owns the decision. The renderer only renders it.
        const reported = parseGatewayGate(payload?.gateway);
        setGateway(reported);
        setGate(resolveGate(reported, isElectron()));
      })
      .catch(() => {
        if (localeEpoch === 0) {
          freezeLocale("en");
        } else {
          applyLocale("en");
        }
        setGateway(null);
        setGate("onboarding");
      });
  }, [localeEpoch]);

  if (gate === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-app text-inkbase">
        <div className="flex w-[280px] flex-col items-center gap-4">
          <p className="text-sm font-medium tracking-[var(--track)] text-[var(--text)]">
            {t("common.starting", { productName })}
          </p>
          <div className="h-0.5 w-full overflow-hidden bg-[var(--line)]">
            <div className="h-full w-1/3 bg-[var(--accent)]" />
          </div>
        </div>
      </main>
    );
  }

  if (gate === "onboarding") {
    return <OnboardingScreen gateway={gateway} onDone={() => setGate("app")} />;
  }

  return (
    <Shell key={localeEpoch}>
      <div className="relative h-full min-h-0 overflow-y-auto">
        {/* An owner who onboarded long ago never sees the setup panel; this runs it with no UI. */}
        <ComponentSetupSilent />
        <WorkModeKeepAlive />
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          {/* Work modes render via WorkModeKeepAlive — null here avoids double-mount. */}
          <Route path="/chat" element={null} />
          <Route path="/documents" element={null} />
          <Route path="/research" element={null} />
          <Route path="/finance" element={null} />
          <Route path="/data" element={null} />
          <Route path="/market" element={null} />
          <Route path="/images" element={null} />
          <Route path="/videos" element={null} />
          <Route path="/music" element={null} />
          <Route path="/edit" element={null} />
          <Route path="/presentations" element={null} />
          <Route path="/legal" element={null} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/studio/*" element={<Navigate to="/chat" replace />} />
          <Route path="/agents/*" element={<Navigate to="/chat" replace />} />
          <Route path="/workspace" element={<Navigate to="/chat" replace />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </div>
    </Shell>
  );
}

function HomeRedirect() {
  return <Navigate to={firstVisibleHref([...WORK_PRODUCT_MODES])} replace />;
}
