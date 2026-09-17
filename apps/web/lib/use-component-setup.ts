"use client";

import { useCallback, useEffect, useState } from "react";
import type { JobEvent } from "@agentforge/core/jobs";
import {
  EMPTY_SETUP,
  failSetup,
  fetchComponents,
  installComponent,
  pickComponentToSetUp,
  reduceSetup,
  shouldAutoInstall,
  type ComponentStatus,
  type SetupState,
} from "./components-client";
import { JobStreamError } from "./job-stream";

export type ComponentSetupView = {
  /** The component this panel speaks for, or `null` when there is nothing to show. */
  readonly component: ComponentStatus | null;
  readonly setup: SetupState;
  /** Another window (or an earlier mount) owns the install; we watch instead of racing it. */
  readonly alreadyRunning: boolean;
  readonly visible: boolean;
  readonly retry: () => void;
};

/**
 * First-run setup for the optional native components.
 *
 * On mount it asks the host what it has; a component that is `missing` **and** `auto` is installed
 * once, right there. Everything else — ready, unsupported, or an install the owner must ask for —
 * renders nothing at all.
 *
 * The install is aborted on unmount. Under React StrictMode the first effect is torn down while its
 * status fetch is still in flight, so no install is ever posted twice; the `busy` answer the host
 * gives a genuine second window is shown as "already running" and the status is polled again.
 *
 * Nothing here can fail the app: a failed install leaves a sentence and a Retry button, and the
 * reduced local reader keeps working.
 */
export function useComponentSetup(): ComponentSetupView {
  const [component, setComponent] = useState<ComponentStatus | null>(null);
  const [setup, setSetup] = useState<SetupState>(EMPTY_SETUP);
  const [alreadyRunning, setAlreadyRunning] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the Retry trigger, so bumping it is exactly how this effect is asked to run again
  useEffect(() => {
    const abort = new AbortController();
    let live = true;

    const adopt = (found: ComponentStatus | null) => {
      setComponent(found);
      setAlreadyRunning(found?.state === "installing");
    };

    const onEvent = (event: JobEvent) => {
      if (live) {
        setSetup((previous) => reduceSetup(previous, event));
      }
    };

    async function start(): Promise<void> {
      const found = pickComponentToSetUp(await fetchComponents(abort.signal));
      if (!live) {
        return;
      }
      adopt(found);
      if (!found) {
        return;
      }
      const remembered = found.error;
      // Automatic only for `missing`; Retry is the owner asking, so it also re-runs a failed one.
      const install = shouldAutoInstall(found) || (attempt > 0 && found.state === "failed");
      if (!install) {
        // A failure the host still remembers from an earlier attempt in this session.
        if (remembered) {
          setSetup((previous) => failSetup(previous, remembered.code, remembered.message));
        }
        return;
      }
      setSetup(EMPTY_SETUP);
      try {
        const status = await installComponent(found.id, onEvent, abort.signal);
        if (live && status) {
          setComponent(status);
        }
      } catch (error) {
        if (!live || abort.signal.aborted) {
          return;
        }
        const code = error instanceof JobStreamError ? error.code : "download_failed";
        const message = error instanceof Error ? error.message : "";
        if (code === "busy") {
          setAlreadyRunning(true);
          setSetup(EMPTY_SETUP);
          const again = pickComponentToSetUp(await fetchComponents(abort.signal));
          if (live) {
            setComponent(again);
          }
          return;
        }
        setSetup((previous) => failSetup(previous, code, message));
      }
    }

    void start();
    return () => {
      live = false;
      abort.abort();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setSetup(EMPTY_SETUP);
    setAlreadyRunning(false);
    setAttempt((count) => count + 1);
  }, []);

  return { component, setup, alreadyRunning, visible: component !== null, retry };
}
