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

/**
 * The same kind of budget for `./edit/agent-run`, a lighter closure than the router but the same
 * shape: it pulls in core, db, the settings store and the tool registry. Measured on the Windows
 * desk on 2026-09-29: 7.3 s for the cold import on an otherwise idle machine (5.2 s of it vite-node
 * transform), and the first case of `agent-title.test.ts` failed at vitest's 5 s default every run,
 * alone or inside `ci:local`. The busy-machine ratio measured for the router (about 4x) puts this
 * import near 30 s on a loaded desk, so 60 s covers it twice over and still fails a real hang.
 */
export const EDIT_AGENT_IMPORT_BUDGET_MS = 60_000;

/**
 * A plain source scan (`readdirSync` + `readFileSync` over the host tree) costs about half a second
 * on an idle machine and nothing else, but it is synchronous and it shares a core with the rest of
 * the package. Inside `ci:local` on 2026-09-29, with 11 forks cold-importing 350 to 650 modules
 * each, `settings-desk-scope.test.ts` took 10.2 s for the same 288 files and failed at the 5 s
 * default. The scan is not slow; the machine is. A budget this size still turns a scan that hangs
 * into a failure.
 */
export const SOURCE_SCAN_BUDGET_MS = 60_000;
