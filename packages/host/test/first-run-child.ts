/**
 * A real host process for `src/first-run-modes.test.ts`: it opens the data dir it is pointed at,
 * runs the named steps through the real router, prints one JSON line per step and exits.
 *
 * It exists because "Start over" is a wipe queued in one process and applied while the NEXT one
 * boots, before SQLite opens (`packages/db/src/client.ts`). Nothing in a single process can show
 * that the desk comes back with the first-run modes afterwards, so the test runs this twice:
 * `AGENTFORGE_APPLY_PENDING_RESET=1` on the second run is what the packaged app and webdev set.
 *
 * Each result is one stdout line, `ROW <json>`. Steps: `desk` (GET workspaces), `widen` (PATCH the
 * current desk to every mode), `guide` (GET the settings answer's `guide`), `finish-guide` (record
 * that the tour was finished), `startover` (POST the fresh-install reset with its confirmation word).
 */
import { PRODUCT_MODE_IDS } from "@agentforge/core";

type Json = Record<string, unknown>;

/** One result row. Prefixed so a log line the host prints on the way (info goes to stdout) is never read as one. */
function emit(row: Json): void {
  console.log(`ROW ${JSON.stringify(row)}`);
}

async function main(): Promise<void> {
  const { dispatch } = await import("../src/router");
  const { sql } = await import("@agentforge/db");

  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
    const result = await dispatch({ method, path, query: {}, params: {}, headers: {}, body });
    if (result.type !== "json") {
      throw new Error(`expected json from ${method} ${path}, got ${result.type}`);
    }
    return { status: result.status, body: (result.body ?? {}) as Json };
  }

  async function currentDesk(): Promise<{ id: string; slug: string; productModes: string[] }> {
    const { body } = await call("GET", "/api/v1/workspaces");
    const desks = body.workspaces as Array<{ id: string; slug: string; productModes: string[] }>;
    const current = desks.find((desk) => desk.id === body.currentWorkspaceId) ?? desks[0];
    return { id: current.id, slug: current.slug, productModes: current.productModes };
  }

  for (const step of process.argv.slice(2)) {
    if (step === "desk") {
      const desk = await currentDesk();
      const raw = sql.prepare("SELECT product_modes AS modes FROM workspaces WHERE slug = 'home'").get() as
        | { modes: string | null }
        | undefined;
      emit({ step, desk, stored: raw?.modes ? JSON.parse(raw.modes) : null });
    } else if (step === "widen") {
      const desk = await currentDesk();
      const answer = await call("PATCH", `/api/v1/workspaces/${desk.id}`, { productModes: [...PRODUCT_MODE_IDS] });
      emit({ step, status: answer.status });
    } else if (step === "guide") {
      const answer = await call("GET", "/api/v1/settings");
      emit({ step, guide: answer.body.guide ?? null });
    } else if (step === "finish-guide") {
      const answer = await call("POST", "/api/v1/settings/guide", { outcome: "finished" });
      emit({ step, status: answer.status, guide: answer.body.guide ?? null });
    } else if (step === "startover") {
      const answer = await call("POST", "/api/v1/settings/reset", { scope: "all", confirm: "RESET" });
      emit({ step, status: answer.status, relaunch: answer.body.relaunch ?? null });
    } else {
      throw new Error(`unknown step ${step}`);
    }
  }
  sql.close();
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exit(1);
  },
);
