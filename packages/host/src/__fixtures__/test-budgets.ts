/**
 * Time budgets for the host tests whose cost is loading modules, not the thing they assert.
 *
 * `import("../router")` evaluates about 650 modules (host, core, db and the three packs) in a fresh
 * worker process. Measured on the Windows desk on 2026-09-24: about 14 s for one file on its own,
 * about 35 s while the rest of the package runs beside it in 11 forks, and past 60 s (music reached
 * 52 s) when a second suite shared the machine, which is what a local CI run next to other work
 * looks like. vitest's own hook default is 10 s. A budget this size still turns a real hang into a
 * failure; it only stops a busy machine from reading as one.
 *
 * Only for a hook or case that does such an import. The global defaults stay where they are.
 */
export const ROUTER_IMPORT_BUDGET_MS = 180_000;
