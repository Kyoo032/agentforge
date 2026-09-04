"use client";

import { useEffect, useState } from "react";
import { isElectron } from "@/lib/api-client";
import { useProductBrand } from "@/lib/product-brand";

type UpdateStatus = "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "error" | "unavailable";

type UpdateState = {
  supported: boolean;
  status: UpdateStatus;
  currentVersion?: string;
  version?: string;
  percent?: number;
  message?: string;
};

function desktopUpdates() {
  return window.agentforge?.updates;
}

export function AppUpdates() {
  const { productName } = useProductBrand();
  const [state, setState] = useState<UpdateState>({
    supported: false,
    status: isElectron() ? "idle" : "unavailable",
  });
  const [busy, setBusy] = useState(false);

  const supported = productName === "Agentforge" && Boolean(desktopUpdates()?.supported);

  useEffect(() => {
    if (productName !== "Agentforge") {
      return;
    }
    const api = desktopUpdates();
    if (!api) {
      setState({ supported: false, status: "unavailable" });
      return;
    }
    void api.state().then((next) => setState({ ...next, status: next.status ?? "idle" }));
    const stop = api.onStatus?.((next) => {
      setState((current) => ({ ...current, ...next }));
    });
    return () => {
      stop?.();
    };
  }, [productName]);

  if (productName !== "Agentforge") {
    return null;
  }

  async function check() {
    const api = desktopUpdates();
    if (!api) {
      return;
    }
    setBusy(true);
    try {
      const next = await api.check();
      setState({ ...next, status: next.status ?? "idle" });
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        message: error instanceof Error ? error.message : "Could not check for updates.",
      }));
    } finally {
      setBusy(false);
    }
  }

  async function updateAndRestart() {
    const api = desktopUpdates();
    if (!api) {
      return;
    }
    setBusy(true);
    try {
      if (state.status !== "ready") {
        const downloaded = await api.download();
        setState({ ...downloaded, status: downloaded.status ?? "ready" });
      }
      await api.install();
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        message: error instanceof Error ? error.message : "Could not install the update.",
      }));
      setBusy(false);
    }
  }

  const versionLine = state.currentVersion ? `This install is ${state.currentVersion}.` : "This install.";
  const statusLine =
    state.status === "checking"
      ? "Checking GitHub Releases…"
      : state.status === "current"
        ? "You are on the latest Agentforge."
        : state.status === "available"
          ? `Version ${state.version ?? ""} is ready to download.`
          : state.status === "downloading"
            ? `Downloading${state.percent != null ? ` ${Math.round(state.percent)}%` : "…"}`
            : state.status === "ready"
              ? `Version ${state.version ?? ""} is downloaded. Restart to finish.`
              : state.status === "error"
                ? state.message ?? "Update check failed."
                : supported
                  ? "New GitHub releases download here, then Agentforge restarts."
                  : "Available in the installed Agentforge app. New GitHub releases download and restart the app.";

  return (
    <section className="blueprint p-[18px]" data-testid="app-updates">
      <p className="panel-label">Updates</p>
      <p className="mt-2 text-sm text-inkbase" data-testid="app-updates-status">
        {versionLine} {statusLine}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {supported && (state.status === "available" || state.status === "ready" || state.status === "downloading") ? (
          <button
            type="button"
            className="btn btn-primary"
            data-testid="app-updates-install"
            disabled={busy || state.status === "downloading"}
            onClick={() => void updateAndRestart()}
          >
            Update and restart
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="app-updates-check"
            disabled={!supported || busy}
            onClick={() => void check()}
          >
            Check for updates
          </button>
        )}
      </div>
    </section>
  );
}
