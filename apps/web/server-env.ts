/**
 * Boot environment for the webdev server. Imported for its side effects only, and imported FIRST.
 *
 * `packages/db/src/client.ts` applies a queued "Start over" wipe at boot, but only for a process
 * that opted in with `AGENTFORGE_APPLY_PENDING_RESET=1` — importing the database must never delete
 * anybody's data by accident. The web server is one of the two processes that are allowed to
 * (the Electron shell's `bootstrapPackaged()` is the other), so it opts in here.
 *
 * It has to be its own module because ESM hoists every `import` above the module body: an
 * assignment at the top of `server.ts` would run *after* `@agentforge/host` — and therefore after
 * `@agentforge/db` — had already been evaluated. A side-effect import placed above the host import
 * is the only thing that runs early enough.
 */
process.env.AGENTFORGE_APPLY_PENDING_RESET = "1";
