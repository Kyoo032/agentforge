import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { parseCapabilities, type HostCapabilities } from "@agentforge/core/capabilities";
import { isElectron } from "@/lib/api-client";
import { pingOnce } from "@/lib/host-ping";

/**
 * Phase 8 — what this deployment can do, as the renderer sees it.
 *
 * The host resolves the flags from its own mode and puts them on `GET /api/v1/ping`
 * (`packages/core/src/capabilities.ts`); this reads them. Until Phase 8 the renderer decided for
 * itself with `isElectron()` in nine files, and that was a different statement than it looked:
 * `isElectron()` is false on webdev as well as on the hosted server, so every rule hung on it was
 * really saying "not the packaged app". Webdev has "Start over" and the hosted server must not,
 * and no amount of `isElectron()` can tell those two apart.
 *
 * **Everything defaults to false.** `EVERYTHING_OFF` is what a consumer reads before ping has
 * answered and what it keeps if ping fails, so a surface is hidden until the host has said it
 * exists. That is the fail-closed direction: the cost of being wrong is a control that appears a
 * moment late, against a control that appears and then answers 403.
 *
 * **The flags never stand alone.** Every one of them has a refusal behind it on the host, with its
 * own error code. A hidden button is a courtesy to the person; the refusal is the control.
 *
 * **`relaunch`, `updater` and `nativeFilePicker` are ANDed with the bridge**, by their consumers.
 * The host can say a shell is *possible* on this target; only the renderer can see whether a
 * preload actually attached. Webdev is exactly that case — not the hosted server, and still no
 * shell to ask.
 */
export const EVERYTHING_OFF: HostCapabilities = Object.freeze(parseCapabilities(null));

const CapabilitiesContext = createContext<HostCapabilities>(EVERYTHING_OFF);

export function useHostCapabilities(): HostCapabilities {
  return useContext(CapabilitiesContext);
}

/**
 * True when the packaged shell is attached AND the host says this target may have one.
 *
 * Both halves are needed and neither is enough: the bridge alone would offer a relaunch on a
 * hypothetical packaged build pointed at a hosted host, and the flag alone would offer one on
 * webdev, where there is no shell to ask and the answer is `unavailable`.
 */
export function hasDesktopShell(capabilities: HostCapabilities): boolean {
  return isElectron() && capabilities.relaunch;
}

/** The same test for the native picker, which is a separate capability from the shell. */
export function hasNativeFilePicker(capabilities: HostCapabilities): boolean {
  return isElectron() && capabilities.nativeFilePicker;
}

function capabilitiesFrom(payload: unknown): HostCapabilities {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  // `apiFetch` over the desktop IPC transport answers `{ body: … }`; over HTTP it answers the body
  // itself. Same unwrapping `brandFromUnknown` does, and for the same reason.
  const nested = record.body && typeof record.body === "object" ? (record.body as Record<string, unknown>) : record;
  return parseCapabilities(nested.capabilities);
}

export function HostCapabilitiesProvider({ children }: { children: ReactNode }) {
  const [capabilities, setCapabilities] = useState<HostCapabilities>(EVERYTHING_OFF);

  useEffect(() => {
    let live = true;
    void pingOnce().then((payload) => {
      if (live) {
        setCapabilities(capabilitiesFrom(payload));
      }
    });
    return () => {
      live = false;
    };
  }, []);

  return <CapabilitiesContext.Provider value={capabilities}>{children}</CapabilitiesContext.Provider>;
}

/** Test seam: render a subtree with a known set of capabilities and no network at all. */
export function HostCapabilitiesFixture({
  capabilities,
  children,
}: {
  capabilities: HostCapabilities;
  children: ReactNode;
}) {
  return <CapabilitiesContext.Provider value={capabilities}>{children}</CapabilitiesContext.Provider>;
}
