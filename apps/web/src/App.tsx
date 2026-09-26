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
import { ChannelsPage } from "@/components/channels-page";
import { DeskPane } from "@/components/desk-pane";
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
import { PlanBlockBoundary } from "@/components/plan-blocked-screen";
import { PricingPage } from "@/components/pricing-page";
import { SignInScreen } from "@/components/sign-in-screen";
import { AuthCallbackPage } from "@/src/pages/auth-callback-page";
import { bootView, SessionProvider, useSession, type BootView } from "@/lib/session";

export type ShellWorkspace = {
  readonly id: string;
  readonly name: string;
  readonly productModes: ProductMode[] | undefined;
};

/**
 * The desk a `GET /api/v1/workspaces` answer names, or null to leave the shell where it is.
 *
 * Every work mode is keyed on this id (`WorkModeKeepAlive`), so a different id — `null` included —
 * unmounts and remounts all of them: a live Meeting recording ends and every job pane loses its
 * in-flight state. The shell asks again on every navigation, and it used to read the body without
 * looking at the status, so a refusal (a 401 as a session lapsed, a 5xx, a proxy's error page) read
 * as "no desks" and did exactly that. Only an answer that names a desk may change it.
 */
export function shellWorkspaceFrom(ok: boolean, payload: unknown): ShellWorkspace | null {
  if (!ok || !payload || typeof payload !== "object") {
    return null;
  }
  const body = payload as { currentWorkspaceId?: unknown; workspaces?: unknown };
  const rows = (Array.isArray(body.workspaces) ? body.workspaces : []).filter(
    (row): row is { id: string; name?: unknown; productModes?: ProductMode[] } =>
      Boolean(row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"),
  );
  const current = rows.find((row) => row.id === body.currentWorkspaceId) ?? rows[0];
  if (!current) {
    return null;
  }
  return {
    id: current.id,
    name: typeof current.name === "string" && current.name ? current.name : HOME_WORKSPACE_NAME,
    productModes: current.productModes,
  };
}

function Shell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState(HOME_WORKSPACE_NAME);
  const [visibleModes, setVisibleModes] = useState<ProductMode[]>([...WORK_PRODUCT_MODES]);

  const reload = useCallback(() => {
    void apiFetch("/api/v1/workspaces")
      .then(async (res) => shellWorkspaceFrom(res.ok, await res.json().catch(() => null)))
      .then((desk) => {
        if (!desk) {
          return;
        }
        setWorkspaceId(desk.id);
        setWorkspaceName(desk.name);
        setVisibleModes(resolveWorkspaceModes(desk.productModes));
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

/**
 * Phase 9 lane C — the routes that are reachable before anybody has signed in.
 *
 * They are handled ahead of the gate rather than inside the shell's route table, because the shell
 * is exactly what a signed-out visitor may not have: `/sign-in` is where they are sent, and
 * `/auth/callback` is where the portal drops them on the way back. `/pricing` is here for a third
 * reason: prices come from an imported catalog, so it owes nothing to a session, and it is where a
 * `seat_cap_reached` refusal sends somebody who is signed out by definition.
 *
 * Checked as a set rather than routed through a nested `<Routes>`: a descendant route table under
 * `path="*"` matches on the *remaining* path, which would silently stop matching these absolute
 * paths.
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/sign-in", "/auth/callback", "/pricing"]);

function normalisePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.replace(/\/+$/, "") : pathname;
}

function BootScreen() {
  const { productName } = useProductBrand();
  return (
    <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-app text-inkbase">
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

/**
 * `/sign-in`: the screen where there is a session to start, and `/chat` everywhere else.
 *
 * Off a hosted deployment this route has nothing to offer, and somebody already signed in has
 * nothing to do here either — both land back on the desk, which is exactly where the catch-all sent
 * `/sign-in` before this route existed.
 */
function SignInRoute({ view }: { view: BootView }) {
  if (view === "loading") {
    return <BootScreen />;
  }
  return view === "sign-in" ? <SignInScreen /> : <Navigate to="/chat" replace />;
}

/**
 * `/auth/callback`: only ever mounted where a sign-in can be completed. A desk that lands here
 * would otherwise POST an authorization code to a route its host does not serve.
 */
function CallbackRoute({ view, signedIn }: { view: BootView; signedIn: boolean }) {
  if (view === "loading") {
    return <BootScreen />;
  }
  return view === "sign-in" || signedIn ? <AuthCallbackPage /> : <Navigate to="/chat" replace />;
}

export function App() {
  return (
    <SessionProvider>
      <AppRoutes />
    </SessionProvider>
  );
}

/** Exported for the boot tests, which drive it against a known session and no network. */
export function AppRoutes() {
  const location = useLocation();
  const session = useSession();
  const view = bootView(session.status);
  const [gate, setGate] = useState<GateView | "loading">("loading");
  const [gateway, setGateway] = useState<GatewayGatePayload | null>(null);
  const [localeEpoch, setLocaleEpoch] = useState(0);

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
    // Phase 9: the boot order is ping → session → settings. A signed-out visitor to the hosted
    // deployment never makes this call: it answers `401 session_required` (the gate exempts only
    // ping and components), the `.catch` below would read that as `"onboarding"`, and they would be
    // shown a form asking for the operator's gateway key. Off a hosted deployment `view` is "app"
    // as soon as ping answers, so webdev and the desktop reach this exactly as they always did.
    if (view !== "app") {
      return;
    }
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
  }, [localeEpoch, view]);

  const path = normalisePath(location.pathname);
  if (PUBLIC_PATHS.has(path)) {
    return (
      <Routes>
        <Route path="/sign-in" element={<SignInRoute view={view} />} />
        <Route
          path="/auth/callback"
          element={<CallbackRoute view={view} signedIn={session.status === "signed-in"} />}
        />
        {/* Prices are public: the catalog is imported, so this page renders in every mode and
            before anybody has signed in. It is the screen a `seat_cap_reached` or a past-due
            refusal sends people to, which they reach while signed out by definition. */}
        <Route path="/pricing" element={<PricingPage />} />
      </Routes>
    );
  }

  if (view === "loading") {
    return <BootScreen />;
  }

  // A hosted visitor with no session sees the one door they have, wherever they aimed. Rendered in
  // place rather than redirected to `/sign-in`, so a session that ends mid-use does not rewrite the
  // address bar under the person. (The portal round trip itself still lands on `/chat`: the
  // `redirect_uri` is fixed at `/auth/callback` and carries no return path — a deep link survives
  // until the button is pressed, not past it.)
  if (view === "sign-in") {
    return <SignInScreen />;
  }

  if (gate === "loading") {
    return (
      <PlanBlockBoundary>
        <BootScreen />
      </PlanBlockBoundary>
    );
  }

  if (gate === "onboarding") {
    return (
      <PlanBlockBoundary>
        <OnboardingScreen gateway={gateway} onDone={() => setGate("app")} />
      </PlanBlockBoundary>
    );
  }

  return (
    /*
     * Phase 9 lane G's boundary. It is around everything behind a session — the desk, and the two
     * screens on the way to it — and around **nothing** a signed-out visitor can reach.
     *
     * Outside it, deliberately: `/pricing`, because that is where this very screen's "see plans"
     * button points and a boundary round it would answer the button with itself; `/sign-in` and
     * `/auth/callback`, because a paywall in front of the door is a door that cannot open.
     *
     * Inside it, also deliberately: the gateway onboarding screen. A blocked tenant must never end
     * up there (`docs/internal/web-phase5-plans-billing-decisions.md` §3(b)) — they hold no gateway
     * key, so its only exits are not theirs — and wrapping it makes that true by construction
     * rather than by the refusal happening to arrive at the right moment.
     */
    <PlanBlockBoundary>
      <Shell key={localeEpoch}>
        <div className="relative h-full min-h-0 overflow-hidden">
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
            <Route path="/meeting" element={null} />
            <Route
              path="/settings"
              element={
                <DeskPane>
                  <SettingsPage />
                </DeskPane>
              }
            />
            <Route
              path="/usage"
              element={
                <DeskPane>
                  <UsagePage />
                </DeskPane>
              }
            />
            <Route
              path="/workspaces"
              element={
                <DeskPane>
                  <WorkspacesPage />
                </DeskPane>
              }
            />
            <Route
              path="/knowledge"
              element={
                <DeskPane>
                  <KnowledgePage />
                </DeskPane>
              }
            />
            <Route
              path="/channels"
              element={
                <DeskPane>
                  <ChannelsPage />
                </DeskPane>
              }
            />
            <Route path="/studio/*" element={<Navigate to="/chat" replace />} />
            <Route path="/agents/*" element={<Navigate to="/chat" replace />} />
            <Route path="/workspace" element={<Navigate to="/chat" replace />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </div>
      </Shell>
    </PlanBlockBoundary>
  );
}

function HomeRedirect() {
  return <Navigate to={firstVisibleHref([...WORK_PRODUCT_MODES])} replace />;
}
