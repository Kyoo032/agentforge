/**
 * Phase 7 — components on a hosted server are the OPERATOR's, installed once per box.
 *
 * On a desk the installer is a first-run convenience: the owner drags a document in, the host
 * downloads the reader, everyone is happy. A hosted server is the opposite situation. The component
 * directory and the native module in it are shared by every tenant, so an install is neither a
 * tenant's action nor a tenant's cost, and `handlers/components.ts` refuses the install route with
 * `install_disabled` (403) whenever `isServerMode()`. This module is the other half of that rule:
 * what a server IS expected to have, where it may load it from, and how an operator proves it.
 *
 * Three facts live here and nowhere else:
 *
 * 1. `SERVER_COMPONENT_IDS` — the components a server image must ship. The image build runs
 *    `scripts/components.ts check` against this list and fails if one is missing, which is what
 *    makes "a fresh container has anydoc" a property of the build rather than a hope.
 * 2. `serverComponentReport()` — whether each of them actually loads right now, and from where,
 *    which is what the operator script and the image build both print.
 *
 * The third rule, where a server may load a component FROM, lives in `paths.ts` next to the root it
 * is about (`managedComponentsRoot`, `downloadedComponentsAllowed`): the loader in
 * `../file-extract/anydoc.ts` needs it, and this module reaches the probes through `status.ts`,
 * which the loader is itself below.
 *
 * Nothing here downloads. The installer is `install.ts`; this module only answers questions about
 * it, so it is safe to import from the loader (`../file-extract/anydoc.ts`) without a cycle.
 */
import { type EnvLike, isServerMode } from "@agentforge/core";
import { componentManifest } from "./manifest";
import { managedComponentsRoot } from "./paths";
import { componentProbe } from "./status";
import type { ComponentId, ComponentSource } from "./types";
import { COMPONENT_IDS } from "./types";

/**
 * What a server image must be able to load before it serves its first request.
 *
 * Today that is every component in the manifest, and `server.test.ts` asserts it stays that way —
 * a component added to `COMPONENT_IDS` without a decision about the server is a component a fresh
 * container would silently not have. Dropping one from this list is a deliberate edit with a
 * reason, not an omission.
 */
export const SERVER_COMPONENT_IDS: readonly ComponentId[] = Object.freeze([...COMPONENT_IDS]);

/** Why a required component is not usable on this server, in words an operator can act on. */
export type ServerComponentRow = {
  readonly id: ComponentId;
  readonly version: string;
  /** Where it resolved from, or `null` when it did not resolve at all. */
  readonly source: ComponentSource | null;
  readonly ok: boolean;
  readonly detail: string;
};

export type ServerComponentReport = {
  readonly ok: boolean;
  readonly serverMode: boolean;
  /** The operator-owned root, or `null`: printed by the CLI so a misconfiguration is visible. */
  readonly managedRoot: string | null;
  readonly rows: readonly ServerComponentRow[];
};

function rowFor(id: ComponentId, probe: () => ComponentSource | null): ServerComponentRow {
  const { version } = componentManifest(id);
  const source = probe();
  if (source === "bundled") {
    return { id, version, source, ok: true, detail: "bundled with the app (the container image, on a server)" };
  }
  if (source === "downloaded") {
    return { id, version, source, ok: true, detail: "installed in the components root" };
  }
  return { id, version, source: null, ok: false, detail: "does not load on this machine" };
}

/**
 * Whether every component this server is supposed to have actually loads, right now.
 *
 * The probe is the same one `GET /api/v1/components` uses, so this answers the question the route
 * answers — it does not re-derive it from files on disk. `probes` is a test seam; no caller in the
 * image passes it.
 */
export function serverComponentReport(
  env: EnvLike = process.env,
  probes: Partial<Record<ComponentId, () => ComponentSource | null>> = {},
): ServerComponentReport {
  const rows = SERVER_COMPONENT_IDS.map((id) => rowFor(id, probes[id] ?? componentProbe(id)));
  return {
    ok: rows.every((row) => row.ok),
    serverMode: isServerMode(env),
    managedRoot: managedComponentsRoot(env),
    rows,
  };
}
