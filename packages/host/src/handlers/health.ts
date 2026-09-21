/**
 * Phase 8 — is this box alive, and is it ready?
 *
 * Two routes, because they answer two different questions for two different callers, and the plan
 * (`docs/internal/web-migration-plan.md`, Phase 8) only names the second:
 *
 *   GET /healthz             ← liveness. Unauthenticated. The proxy, the container healthcheck.
 *   GET /api/v1/health       ← readiness. Session-gated. A signed-in operator or a support ticket.
 *
 * **Liveness says one word and nothing else.** It replaces `host-status.json`
 * (`apps/desktop/main.cjs:300-312`) as the deploy probe, and its whole job is to tell Caddy and
 * Docker that this process is answering sockets. It carries no version, no path, no tenant, no
 * component list and no backend name, because everything on that list is reconnaissance handed to
 * an unauthenticated caller for free: a version tells a prober which CVEs to try, a path tells
 * them the layout of the disk, a backend name tells them where the bytes are. The security spec's
 * N-rows and the Phase 7 status route both took the same care; this takes it further, because this
 * is the one route on the box that answers a stranger.
 *
 * It is handled in `../http-adapter.ts` rather than by the router's table, because the table is
 * `/api`-only and `dispatch` never sees another path. That is also what keeps it out of the
 * session gate by construction rather than by an entry in an exemption set.
 *
 * **Readiness is a diagnosis, so it is behind the session.** It says whether the database answers,
 * which object-storage backend is configured and whether it could be built, and whether each
 * required native component loads. Every one of those is the sort of detail liveness refuses to
 * give away, which is exactly why this one needs a session to read it.
 *
 * **Neither route is a gate.** `requireGatewayAllowed` is not called here: a tenant whose plan has
 * blocked them must still be able to see whether the box is healthy, or a support conversation
 * starts with two unknowns instead of one. Readiness is also deliberately NOT tenant-scoped — it
 * reports the deployment, not the caller — so it reads nothing of anybody's and returns the same
 * answer to every signed-in session.
 */
import { hostCapabilities, isServerMode, objectStorageKind } from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import { reportComponentStatus } from "../components/install";
import { COMPONENT_IDS } from "../components/types";
import { tenantObjectStore } from "../tenant-storage";
import { log } from "../log";

/** The path the proxy and the container healthcheck poll. Answered by `../http-adapter.ts`. */
export const LIVENESS_PATH = "/healthz";

/**
 * The entire liveness body. A frozen literal, not a builder: there is no input to it and nothing
 * about the deployment may ever leak into it, and the cheapest way to keep that true is for there
 * to be nowhere to put anything.
 */
export const LIVENESS_BODY = Object.freeze({ status: "ok" });

/** One dependency's verdict. `detail` is a fixed phrase, never an exception message. */
export type ReadinessCheck = {
  readonly name: "database" | "storage" | "components";
  readonly ok: boolean;
  /** A short, fixed phrase chosen from this file. Never a thrown message, path or credential. */
  readonly detail: string;
};

/** The narrow slice of a connection the database check needs, so a test can hand it a stub. */
export type HealthSql = {
  prepare(source: string): { get(...params: unknown[]): unknown };
};

export type ReadinessDeps = {
  /** Injected so a test can drive a failing dependency without breaking the process's own. */
  readonly sql?: () => HealthSql;
  readonly storage?: () => { readonly kind: string };
  readonly components?: () => ReadonlyArray<{ readonly id: string; readonly state: string }>;
  readonly serverMode?: () => boolean;
};

/**
 * `SELECT 1` and nothing heavier.
 *
 * A readiness probe that counted rows would get slower as the deployment got busier, which is
 * backwards: the one moment you most need an answer is the moment the box is under load. What this
 * proves is that the file is open, the schema ran and the connection is not wedged behind a lock,
 * which is the whole of what "the database answers" means here.
 */
function checkDatabase(deps: ReadinessDeps): ReadinessCheck {
  try {
    const sql = deps.sql ? deps.sql() : requireHealthSql();
    sql.prepare("SELECT 1").get();
    return { name: "database", ok: true, detail: "answers" };
  } catch (error) {
    // The message goes to the log, where the operator reads it, and never into the response: a
    // SQLite error names the file's absolute path.
    log.error("health_database_failed", { error });
    return { name: "database", ok: false, detail: "did not answer" };
  }
}

/**
 * Which backend holds tenant bytes, and whether this process could build a client for it.
 *
 * Building the COS store is the check: `createCosObjectStore` throws when the bucket, the region
 * or the credentials are missing (`../tenant-storage-cos.ts`), which is the misconfiguration worth
 * catching before a tenant's first upload discovers it. It deliberately stops there and does NOT
 * reach the bucket: a listing or a HEAD is a billed request, and a readiness route polled every
 * few seconds would bill the operator for a number nobody reads. A bucket that exists but refuses
 * this key is what the first upload finds, and what `recomputeTenantStorage` is for.
 *
 * The backend's name is in the body because this route is behind a session. Liveness says nothing.
 */
function checkStorage(deps: ReadinessDeps): ReadinessCheck {
  const configured = objectStorageKind();
  try {
    const kind = deps.storage ? deps.storage().kind : tenantObjectStore().kind;
    return { name: "storage", ok: true, detail: `${kind} backend configured` };
  } catch (error) {
    log.error("health_storage_failed", { error, configured });
    return { name: "storage", ok: false, detail: `${configured} backend is not usable` };
  }
}

/**
 * Do the native components this box needs actually load?
 *
 * `reportComponentStatus` runs the same probe a request would (`../components/status.ts`), so a
 * `ready` here means a document upload will read rather than fall back to the reduced extractor —
 * the silent downgrade Phase 7 built the build-time check to prevent
 * (`docs/internal/web-phase7-component-installer.md` §1). A component the platform has no package
 * for is `unsupported`, which is a fact about the platform and not a failure of this box, so it
 * does not make the box unready.
 *
 * The body names the ids and their states and nothing else — no version, no path, no root. A
 * version here would tell a signed-in caller exactly which build of a native library to look up,
 * and the operator who needs that reads `GET /api/v1/components`, which already carries it.
 */
function checkComponents(deps: ReadinessDeps): ReadinessCheck & { readonly items: ReadonlyArray<{ id: string; state: string }> } {
  let items: ReadonlyArray<{ id: string; state: string }>;
  try {
    items = deps.components
      ? deps.components().map((item) => ({ id: item.id, state: item.state }))
      : COMPONENT_IDS.map((id) => {
          const status = reportComponentStatus(id);
          return { id: status.id, state: status.state };
        });
  } catch (error) {
    log.error("health_components_failed", { error });
    return { name: "components", ok: false, detail: "could not be read", items: [] };
  }
  const broken = items.filter((item) => item.state !== "ready" && item.state !== "unsupported");
  return {
    name: "components",
    ok: broken.length === 0,
    detail: broken.length === 0 ? "all load" : `${broken.length} not loading`,
    items,
  };
}

let healthSql: HealthSql | null = null;

/**
 * Installed by `../health-db.ts`, which `../router.ts` imports — the same seam
 * `tenant-state-db.ts`, `entitlement-db.ts` and `tenant-storage-db.ts` use, and for the same
 * reason: `@agentforge/db`'s entry point opens the database as an import side effect, and this
 * module is reached from the router's import graph in processes that have no database at all.
 */
export function registerHealthSql(sql: HealthSql): void {
  healthSql = sql;
}

/** Test seam: go back to "nothing installed", which is what a fresh process looks like. */
export function resetHealthSqlForTests(): void {
  healthSql = null;
}

function requireHealthSql(): HealthSql {
  if (!healthSql) {
    throw new Error("health_sql_not_registered");
  }
  return healthSql;
}

/**
 * `GET /api/v1/health` — the readiness answer.
 *
 * Always HTTP 200, with `ready` in the body saying what the verdict is. A 503 would be the other
 * reasonable choice and it is the wrong one here: this route is read by a person and by a support
 * script, not by an orchestrator, and every HTTP client in between treats a 503 as a reason to
 * retry, hide the body or serve a cached page — which loses the diagnosis the route exists to
 * give. The probe that an orchestrator reads is `/healthz`, and that one is up or it is nothing.
 */
export async function handleGetHealth(request: HostRequest, deps: ReadinessDeps = {}): Promise<HostResult> {
  try {
    // Session-gated by `../router.ts` in server mode; on a desk this resolves the local owner and
    // the route is a diagnostic the owner can read about their own machine.
    await getTenant(request);
    const serverMode = deps.serverMode ? deps.serverMode() : isServerMode();
    const database = checkDatabase(deps);
    const storage = checkStorage(deps);
    const components = checkComponents(deps);
    return jsonOk({
      ready: database.ok && storage.ok && components.ok,
      mode: serverMode ? "server" : "desk",
      capabilities: hostCapabilities(),
      checks: [
        { name: database.name, ok: database.ok, detail: database.detail },
        { name: storage.name, ok: storage.ok, detail: storage.detail },
        { name: components.name, ok: components.ok, detail: components.detail, items: components.items },
      ],
    });
  } catch (error) {
    return jsonError(error);
  }
}
