"use client";

import { useEffect, useState } from "react";
import { getDesktopUpdates, isElectron } from "@/lib/api-client";
import {
  normalizeUpdateSnapshot,
  shortUpdateMessage,
  type UpdateState,
  updateStatusLine,
  updateVersionLine,
} from "@/lib/app-updates-copy";
import { useProductBrand } from "@/lib/product-brand";

const AGENTFORGE_PRODUCT_NAME = "Agentforge";
const CHECK_FAILED_MESSAGE = "Could not check for updates.";
const INSTALL_FAILED_MESSAGE = "Could not install the update.";

function desktopUpdates() {
  return getDesktopUpdates();
}

function initialUpdateState(): UpdateState {
  return {
    supported: Boolean(desktopUpdates()?.supported),
    status: isElectron() ? "idle" : "unavailable",
  };
}

export function AppUpdates() {
  const { productName } = useProductBrand();
  const [state, setState] = useState<UpdateState>(initialUpdateState);
  const [busy, setBusy] = useState(false);

  const supported = productName === AGENTFORGE_PRODUCT_NAME && state.supported;

  useEffect(() => {
    if (productName !== AGENTFORGE_PRODUCT_NAME) {
      return;
    }
    const api = desktopUpdates();
    if (!api) {
      setState({ supported: false, status: "unavailable" });
      return;
    }
    void api
      .state()
      .then((next) => setState(normalizeUpdateSnapshot(next, "idle")))
      .catch((error: unknown) => {
        setState((current) => ({
          ...current,
          status: "error",
          message: shortUpdateMessage(error, CHECK_FAILED_MESSAGE),
        }));
      });
    const stop = api.onStatus?.((next) => {
      setState((current) => ({ ...current, ...normalizeUpdateSnapshot(next, current.status) }));
    });
    return () => {
      stop?.();
    };
  }, [productName]);

  if (productName !== AGENTFORGE_PRODUCT_NAME) {
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
      setState(normalizeUpdateSnapshot(next, "idle"));
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        message: shortUpdateMessage(error, CHECK_FAILED_MESSAGE),
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
        const next = normalizeUpdateSnapshot(downloaded, "ready");
        setState(next);
        if (next.status === "error") {
          setBusy(false);
          return;
        }
      }
      await api.install();
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        message: shortUpdateMessage(error, INSTALL_FAILED_MESSAGE),
      }));
      setBusy(false);
    }
  }

  const statusText = [updateVersionLine(state.currentVersion), updateStatusLine(state, supported)]
    .filter((part) => part.length > 0)
    .join(" ");

  return (
    <section className="blueprint p-[18px]" data-testid="app-updates">
      <p className="panel-label">Updates</p>
      <p className="mt-2 break-words text-sm text-inkbase" data-testid="app-updates-status">
        {statusText}
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
