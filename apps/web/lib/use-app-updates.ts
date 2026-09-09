import { useCallback, useEffect, useState } from "react";
import { getDesktopUpdates, isElectron } from "@/lib/api-client";
import {
  normalizeUpdateSnapshot,
  shortUpdateMessage,
  type UpdateState,
  updateStatusLine,
  updateVersionLine,
} from "@/lib/app-updates-copy";

/** Only the public DPSBuddy flavor reads the GitHub release feed; Kemenkeu / Metranet never do. */
export const PUBLIC_PRODUCT_NAME = "DPSBuddy";
const CHECK_FAILED_MESSAGE = "Could not check for updates.";
const INSTALL_FAILED_MESSAGE = "Could not install the update.";

export type AppUpdatesController = {
  /** False for branded flavors: render nothing. */
  visible: boolean;
  /** True only in the packaged public app where the updater can actually download and install. */
  supported: boolean;
  state: UpdateState;
  busy: boolean;
  statusText: string;
  check: () => Promise<void>;
  updateAndRestart: () => Promise<void>;
};

function initialUpdateState(): UpdateState {
  return {
    supported: Boolean(getDesktopUpdates()?.supported),
    status: isElectron() ? "idle" : "unavailable",
  };
}

function errorState(current: UpdateState, error: unknown, fallback: string): UpdateState {
  return { ...current, status: "error", message: shortUpdateMessage(error, fallback) };
}

/** Desktop updater state + actions, shared by whichever surface renders the Updates control. */
export function useAppUpdates(productName: string): AppUpdatesController {
  const visible = productName === PUBLIC_PRODUCT_NAME;
  const [state, setState] = useState<UpdateState>(initialUpdateState);
  const [busy, setBusy] = useState(false);
  const supported = visible && state.supported;

  useEffect(() => {
    if (!visible) {
      return;
    }
    const api = getDesktopUpdates();
    if (!api) {
      setState({ supported: false, status: "unavailable" });
      return;
    }
    void api
      .state()
      .then((next) => setState(normalizeUpdateSnapshot(next, "idle")))
      .catch((error: unknown) => setState((current) => errorState(current, error, CHECK_FAILED_MESSAGE)));
    const stop = api.onStatus?.((next) => {
      setState((current) => ({ ...current, ...normalizeUpdateSnapshot(next, current.status) }));
    });
    return () => {
      stop?.();
    };
  }, [visible]);

  const check = useCallback(async () => {
    const api = getDesktopUpdates();
    if (!api) {
      return;
    }
    setBusy(true);
    try {
      setState(normalizeUpdateSnapshot(await api.check(), "idle"));
    } catch (error) {
      setState((current) => errorState(current, error, CHECK_FAILED_MESSAGE));
    } finally {
      setBusy(false);
    }
  }, []);

  const updateAndRestart = useCallback(async () => {
    const api = getDesktopUpdates();
    if (!api) {
      return;
    }
    setBusy(true);
    try {
      if (state.status !== "ready") {
        const next = normalizeUpdateSnapshot(await api.download(), "ready");
        setState(next);
        if (next.status === "error") {
          setBusy(false);
          return;
        }
      }
      await api.install();
    } catch (error) {
      setState((current) => errorState(current, error, INSTALL_FAILED_MESSAGE));
      setBusy(false);
    }
  }, [state.status]);

  const statusText = [updateVersionLine(state.currentVersion), updateStatusLine(state, supported)]
    .filter((part) => part.length > 0)
    .join(" ");

  return { visible, supported, state, busy, statusText, check, updateAndRestart };
}
