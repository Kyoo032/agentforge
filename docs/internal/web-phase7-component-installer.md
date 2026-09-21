# Phase 7 — the component installer, per server

Record of the Phase 7 change. Plan: [`web-migration-plan.md`](web-migration-plan.md) §"Phase 7 —
Component installer per server". Map: [`maps/component-installer.md`](maps/component-installer.md).
Runbook: [`tencent-cvm-setup.md`](tencent-cvm-setup.md) §4 and the new §12a.
Security: [`web-security-spec.md`](web-security-spec.md) H3, which this phase makes satisfiable, and
[`security-owasp-2026-09.md`](security-owasp-2026-09.md) A01-3, whose route refusal landed in #88.
Predecessors: [`web-phase4-tenant-secrets.md`](web-phase4-tenant-secrets.md) (the flag-picks-the-rule
pattern), [`web-phase6-tenant-storage.md`](web-phase6-tenant-storage.md) (the tenant data volume this
phase moves executable content off).

Branch `claude/web-phase7-component-installer-7f5d5l`, cut from `main` at `2d44f0f`.

The plan's done-when: **"A fresh container has the component before it serves its first request, and
no tenant can start a download."**

---

## 1. What was actually true before this change

The second half was already done. PR #88 closed OWASP A01-3 by refusing
`POST /api/v1/components/install/stream` with `install_disabled` (403) whenever `isServerMode()`, and
`packages/host/src/handlers/components.ts:60-70` carries the reasoning. Nothing in this phase weakens
or re-litigates that; the tests for it are untouched.

The first half was a hope, not a property. Three separate gaps:

1. **Nothing proved the image had `anydoc`.** It arrives because `@firecrawl/anydoc` is a dependency
   of `@agentforge/host`, `pnpm-lock.yaml` resolves the `-linux-x64-gnu` prebuilt, and the
   Dockerfile's filtered install happens to pull it in. Every one of those is a link that can break
   without a noise: a filter change, a hoisting change, a platform package that stops publishing.
   When it breaks, the container still builds, still boots, still answers the healthcheck, and reads
   every uploaded document with the reduced fallback extractor
   (`packages/host/src/file-extract/fallback.ts`) — quietly, for as long as nobody compares output.
2. **The operator had no way to install one.** The install route is the only installer, and it
   answers 403 to everyone on a server, operator included. So a manifest version bump between images
   meant a rebuild and a restart, or nothing.
3. **`/data` could not be mounted `noexec`.** Security spec H3 has been waiting on exactly one
   sentence: the host would `createRequire` a native `.node` file out of `<data dir>/components` if
   one were there. It is not there today — the bundled copy resolves first — but "not there today"
   is not a rule, and `/data` is the volume every tenant writes into
   ([`web-phase6-tenant-storage.md`](web-phase6-tenant-storage.md)). The compose file and the runbook
   both say `noexec` is blocked on this phase, in those words.

---

## 2. The rule

> **A component on a server belongs to the operator: installed once per box, from the same pinned
> manifest the desk uses, and never loaded out of the tenant data volume.**

Three consequences, and they are the whole phase.

**The image carries it, and the build proves it.** `webapp-deploy/Dockerfile` runs
`tsx scripts/components.ts check` in the build stage. The check loads each required component the way
a request would — `createRequire` on the real native binding — and exits non-zero if one does not, so
the image fails to build instead of shipping a silent downgrade. It runs on the same Debian/glibc
base the runtime stage uses, so a binding that loads there loads in the container.

**The operator, not a tenant, repairs a box.** `scripts/components.ts install` runs the same stage
runner the desk's first run uses, with the same manifest, the same sha512 check before a byte is
unpacked, and the same atomic promote and completion marker. `webapp-deploy/scripts/components.sh`
drives it inside the running container. Nothing here touches the HTTP route, which stays 403 for
everybody.

Be precise about what that command is for, because the obvious reading of it is wrong. **It is a
repair, not an upgrade path.** `installMissing` acts only on a row whose probe returned nothing; on
an image that passed the build check every probe resolves the bundled copy, so `install` prints
`already loads … nothing to install` and exits 0. It therefore *cannot* replace a working bundled
copy with a newer manifest version, and it is not meant to: **a manifest bump is a rebuild, full
stop** — new version in `manifest.ts`, new image, deploy. The one case `install` exists for is the
container whose bundled copy is present but does not load on this machine (a corrupt layer, a
binding built against the wrong libc), where fetching the manifest's copy into the managed root
restores document reading without waiting for a rebuild.

And a repair needs a restart. `file-extract/anydoc.ts:131-150` memoises the loader result for the
life of the process, failure included, and only the in-process `resetAnydocCache()` clears it — which
the CLI, being a separate process, cannot call. The command prints the restart line when it actually
installs something; `components.sh`, the runbook §12a and `webapp-deploy/README.md` all say it too.

**Executable content lives off the data volume.** `AGENTFORGE_COMPONENTS_DIR` moves the components
root; the image sets it to `/opt/agentforge/components`, which `compose.yml` gives its own volume. In
server mode the host refuses to load a component from a root that is inside `AGENTFORGE_DATA_DIR`,
marker or no marker — so H3's `noexec` becomes a mount option rather than a promise.

Unset, everything above is exactly what it was: the desk's root is `<data dir>/components`, the first
run downloads into it, `HOST_RESET_ENTRIES` still removes it, and the frozen desktop is untouched.

---

## 3. What was built

### `packages/host/src/components/paths.ts` — the root, and who may load from it

`componentsRootDir(env)` is new and is now what `componentVersionsDir` resolves against.
`AGENTFORGE_COMPONENTS_DIR` wins when set; otherwise `<localDataDir()>/components`, the path the
subsystem has always used and the one `HOST_RESET_ENTRIES` names. Read per call rather than frozen at
import, for the reason `isServerMode()` is: the suites and `apps/web` both set environment after the
module graph loads.

Two policy functions sit beside it, deliberately in this file rather than in `server.ts`: the loader
needs them and `server.ts` sits above the loader, so putting them here is what keeps the import graph
acyclic.

- `managedComponentsRoot(env)` — the configured root, or `null`. `null` covers both "unset" and "set
  to a path that lands back inside the data dir anyway", which buys nothing: the point of the
  variable is to put executable content somewhere the tenant volume is not. The inside test is run
  **twice**, and `null` wins if either says inside: once lexically with `isInside` from
  `tenant-paths.ts`, and once on both paths canonicalised through `realPathOrNull` from the same
  file. Lexical alone would let `/opt/agentforge/components` be a symlink whose target is
  `/data/components` and read as outside; the claim this function makes is about the inode, so it
  has to resolve. Keeping the lexical test as well is the fail-closed half, for a path that is
  plainly inside but has nothing on disk yet to resolve.
- `downloadedComponentsAllowed(env)` — `true` off server mode, always. In server mode, `true` only
  when there is a managed root.

### `packages/host/src/file-extract/anydoc.ts` — the refusal, at the load site

`loadDownloadedAnydoc()` consults `downloadedComponentsAllowed()` before it looks for the marker. A
refused root throws, `resolveAnydoc` catches it exactly as it catches an absent one, and the status
route reports `missing`. Nothing throws at a request, and the reduced reader takes over — the same
fail-soft posture the subsystem has had since it was written.

This is a **load** rule, not only an install rule. The route's 403 stops a tenant asking for a
download; this stops a directory that is already there — left by an older build, restored from a
backup, written by anything else with the volume mounted — from being `createRequire`d.

### `packages/host/src/components/server.ts` — what a server is supposed to have

`SERVER_COMPONENT_IDS` is the list a server image must carry, and it is every id in the manifest. The
suite asserts that equality, so a component added to `COMPONENT_IDS` without a decision about the
server fails a test rather than quietly not shipping.

`serverComponentReport(env, probes?)` answers, per component: does it load, from where, and at which
version — using the same probe `GET /api/v1/components` uses, not a second derivation from files on
disk. It also reports the managed root (or `null`), so a misconfigured server is visible in the
output rather than silent. `ok` is the `every` of the rows, and it is the CLI's exit code.

### `scripts/components.ts` — the CLI, and the image's gate

Three verbs, run from the repository root:

| Command | What it does | Exit |
|---|---|---|
| `status` | prints mode, components root and a row per component | always 0 |
| `check` | the same, and fails when one does not load | 0 / 1 |
| `install` | fetches only what does **not** load (a repair, never an upgrade), then re-reads and checks, and prints a restart line if it installed anything | 0 / 1 |

Called wrongly it exits 2, like `scripts/rotate-wrap-key.ts`. Every host import is dynamic, for the
reason that script documents: `tsx` compiles to CJS, a static `import` becomes a `require` while
`await import()` goes through the ESM loader, and mixing the two over `components/install.ts` would
give the process two copies of its in-flight register — so the `busy` guard would be guarding nothing.

`install` **refuses up front** on a server whose components root is inside the data dir, naming the
variable to set. Without that refusal the unpack and the probe would both succeed — they work on the
directory directly, and only the loader applies the rule — and the operator would be left with a green
install and a component that keeps reporting `missing`.

### `webapp-deploy/` — the image, the stack and the operator script

- `Dockerfile`: `RUN … tsx scripts/components.ts check` in the build stage, run with
  `AGENTFORGE_SERVER=1` and the runtime stage's `AGENTFORGE_COMPONENTS_DIR` so the check's printout
  is the container's (`mode: server`, root `/opt/agentforge/components`) rather than a desk's —
  which changes nothing about what loads, since the bundled copy inside `node_modules` is what
  resolves either way and `check` never downloads. The runtime stage sets
  `AGENTFORGE_COMPONENTS_DIR=/opt/agentforge/components`, creates that directory, owns it to `node`
  and declares it a volume.
- `compose.yml`: the same variable, a `dpsbuddy-components` volume mounted at that path, and a
  comment saying why it is a separate volume — it holds executable content, so it is the one mount
  that may never be `noexec`, which is precisely why it is not a directory inside `/data`.
- `scripts/components.sh` — `status` (the default), `check`, `install`, each `docker compose exec`ed
  into the app container against the same CLI. It refuses when the container is not running.

### The renderer

`GET /api/v1/components` gains one field, `managed`: true on a hosted server and only there. The
renderer parses it with a `=== true` test, so a host that predates the field — the frozen desktop, an
older webdev — reads as a desk, which is what one is. `pickComponentToSetUp` and `shouldAutoInstall`
both refuse a managed row, so a hosted tenant is never sent to an install screen.

`componentAutoInstallAllowed` also returns false in server mode now, alongside the stub runtime and
test-process rules it already had. Either flag alone would be enough; both are asserted, because the
failure they prevent is a tenant being shown a failed install of something only the operator can fix.

---

## 4. What did not change

- **The desk and webdev.** With `AGENTFORGE_COMPONENTS_DIR` unset and `AGENTFORGE_SERVER` unset, every
  path, every state, every stage and every byte on disk is what it was. `install.test.ts` drives a
  full install end to end against a fake registry and is unchanged apart from one added field in one
  expectation.
- **The manifest.** No URL, version or hash moved. `@firecrawl/anydoc` is still 0.2.4 and the mac pack
  script still pins the same sha512s (`components/mac-pack-pins.test.ts` is untouched and green).
- **The install route's refusal.** Same code, same 403, same tests.
- **`HOST_RESET_ENTRIES`.** "Start over" still removes `<data dir>/components`, which is still where
  a desk's components are. On a server with a managed root, "Start over" no longer removes them —
  correctly: they are the operator's, not the tenant's, and the hosted reset is Phase 8's subject.
- **The healthcheck.** Still `GET /api/v1/components`, still ungated, still answering before any
  session exists. It now carries one more field.
- **No migration.** Nothing about this phase is in the database, so there is no `0020` and the
  forward-only `when` ordering is untouched.

---

## 5. How this was verified

### Suites

Run in the cloud container with the `xlsx` workaround from the handover file's "Environment notes for
cloud sessions"; `package.json`, `pnpm-lock.yaml` and `packages/core/package.json` were restored
afterwards and `git diff --name-only` checked before every commit.

| Suite | Result |
|---|---|
| `@agentforge/host` | 211 files, **2250 passed** |
| `@agentforge/web` | 96 files, **906 passed** |
| `@agentforge/core` | 186 files, **2283 passed**, 1 skipped |
| `@agentforge/db` | 12 files, **154 passed** |
| `node --test scripts/*.test.mjs` | 19 passed across all three files (9 `deploy-scripts`, 7 `audit-deployed`, 3 `components-cli`) |

> Run the web suite from `apps/web`, not with `vitest --root apps/web` from the repository root.
> `lib/finance-stated-facts.test.ts` reads its fixtures with `join(process.cwd(), …)`, so from the
> wrong working directory two of its cases fail with `ENOENT` — on `main` as much as on this branch.
> That is a harness artifact, not a failure.

Typechecks: `tsc --noEmit` per touched package (`packages/host`, `apps/web`, `packages/core`), each at
zero errors — the same baseline the branch point has. Lint: the repository's own
`biome check --formatter-enabled=false --assist-enabled=false` over the touched paths, clean.

> **Line endings.** `biome check --write` rewrites files to CRLF (`biome.json` sets
> `"lineEnding": "crlf"`) while the tree on `main` is LF. Every touched file was converted back to LF
> after formatting and `git diff` re-read to confirm the change is content only. The repository's own
> `lint` script passes `--formatter-enabled=false`, which is why this never shows up in CI.

### Driven for real

- `apps/web/node_modules/.bin/tsx scripts/components.ts check` was run in this container, against the
  real `@firecrawl/anydoc-linux-x64-gnu` binding, with the same `AGENTFORGE_SERVER=1` and
  `AGENTFORGE_COMPONENTS_DIR=/opt/agentforge/components` the Dockerfile's `RUN` now carries. It
  printed `mode: server (AGENTFORGE_SERVER=1)`, `components root: /opt/agentforge/components` and
  `ok anydoc@0.2.4 — bundled with the app (the container image, on a server)`, and exited 0. That is
  the exact command and environment the build stage runs, on the same platform key.
- `scripts/components-cli.test.mjs` spawns the CLI for the wrong-usage, `status` and refusal cases.
- The verify skill (`.cursor/skills/verify-agentforge`) — see §7.

### Maps

`docs/internal/maps/component-installer.md` re-anchored by hand against this branch and extended
with the per-server half. `docs/internal/maps/webapp-deploy.md` gained a *Components are the
image's* section, a sixth script row, a corrected `noexec` gotcha and re-anchored Dockerfile and
`compose.yml` ranges (Phase 7 moved both files' line numbers); `maps/hosted-security-controls.md`
and `maps/database-and-migrations.md` were re-anchored where they cite lines this branch moved. `pnpm maps:check`: **0 hard, 128 soft** across 77 docs and 2210 citations — the same soft count as
`main` (2200 citations), so this branch's ten new citations add none. `pnpm maps:drift main HEAD`
named the citations this branch's own edits moved; every one was re-anchored **by hand** and each
cited range re-read against the working tree, because `map-drift --write` mis-points onto import
lines and `maps:check` does not catch a range that names the wrong lines. Note that `maps:drift` run
after the fact keeps proposing to shift citations that are already correct for the working tree —
it maps `main`'s line numbers forward and cannot tell an already-updated citation from a stale one.
`maps:check`, which reads the tree, is the check that matters.

---

## 6. Live tests still owed

Nothing below can be run from the cloud: it needs Docker, a real image build, and the CVM. Numbered so
a result can be reported by number.

**On kyo's machine (desk, unchanged behaviour):**

1. Start the desk with no `AGENTFORGE_COMPONENTS_DIR` and no `AGENTFORGE_SERVER`. The onboarding
   component panel behaves exactly as before: `anydoc` is bundled, so the panel does not appear.
2. Rename the bundled `@firecrawl/anydoc` out of `node_modules`, restart, and confirm the first-run
   panel appears, downloads, and ends `ready` with source `downloaded` — the unchanged desk path.
3. With the component downloaded, run "Start over" and confirm `<data dir>/components` is removed on
   the next boot, as before.

**On the CVM (or any Docker host), the image:**

4. `docker build -f webapp-deploy/Dockerfile -t dpsbuddy-web:local .` succeeds, and the build log
   shows `ok anydoc@0.2.4` from the check step.
5. Break it deliberately: add `--filter "@agentforge/web"` without the trailing `...`, or remove
   `@firecrawl/anydoc` from `packages/host/package.json`, and confirm the build **fails** at the check
   step with a non-zero exit and `Missing on this machine: anydoc`. Then revert. This is the whole
   point of the step and is worth proving once.
6. `docker compose -f webapp-deploy/compose.yml up -d`, then
   `docker compose exec app env | grep AGENTFORGE_COMPONENTS_DIR` shows `/opt/agentforge/components`.

**On the CVM, the running stack:**

7. `sh webapp-deploy/scripts/components.sh` prints `mode: server (AGENTFORGE_SERVER=1)`,
   `components root: /opt/agentforge/components`, and
   `ok anydoc@0.2.4 — bundled with the app (the container image, on a server)` — the same three
   lines the build log shows.
8. `sh webapp-deploy/scripts/components.sh check` exits 0. Check with `echo $?`.
9. `sh webapp-deploy/scripts/components.sh install` prints
   `anydoc@0.2.4 already loads … nothing to install` and exits 0. It must not download, and it must
   not print the restart line.
10. Sign in as a tenant and open onboarding: no component install panel, no progress bar, nothing to
    click. `GET /api/v1/components` in the browser's network tab shows `"managed": true` and
    `"auto": false`.
11. `curl` the install route with a valid session and confirm `403 install_disabled` — the route
    refusal, still true after this phase.
12. The refusal that cannot be tested in the cloud with a real volume: `docker compose exec app sh -c
    'AGENTFORGE_COMPONENTS_DIR=/data/components ./node_modules/.bin/tsx ../../scripts/components.ts
    install'` must exit 1 with the `OUTSIDE AGENTFORGE_DATA_DIR` refusal and write nothing under
    `/data/components`.
13. **The H3 flip.** Add `noexec` to the `/data` mount (`/etc/fstab`, then remount) and restart the
    stack. Upload a `.docx` and confirm it still converts — proof that nothing is executing out of
    `/data`. Keep `/opt/agentforge/components` without `noexec`. Only sign H3 off after this passes.
14. **The repair path, which is the only thing `install` is for.** In a throwaway container, break
    the bundled copy — `docker compose exec -u root app mv
    /app/node_modules/.pnpm/@firecrawl+anydoc-linux-x64-gnu*/node_modules/@firecrawl/anydoc-linux-x64-gnu
    /tmp/` or equivalent — and restart the app so it re-resolves. `components.sh` must then print
    `MISSING`, and a `.docx` upload must fall back to the reduced reader. Run
    `components.sh install`: it downloads into `/opt/agentforge/components`, verifies the sha512, and
    prints the restart line. **Before** the restart, confirm the app still uses the fallback (the
    loader memoised its failure); **after**
    `docker compose -f webapp-deploy/compose.yml restart app`, confirm `status` reports
    `installed in the components root` and the same `.docx` converts properly. Then throw the
    container away — a box that needed this needs a rebuild.

    Note what is *not* being tested: bumping the manifest version and expecting `install` to fetch
    it. It will not, by design — the bundled copy still loads, so `install` skips it. A version bump
    is a rebuild.
15. Restart the stack and confirm the `dpsbuddy-components` volume survived, i.e. an operator install
    is not lost on `docker compose down && up`.

---

## 7. The verify skill

`.cursor/skills/verify-agentforge`. Nothing answered on `127.0.0.1:3000` in this container, so the
doctor was run against an isolated stub instance on a spare port with its own data directory, as the
skill allows:

```
verify-agentforge doctor: OK — stub runtime. Safe for Chat send without a live gateway.
  url: http://127.0.0.1:3187   surface: webdev   chatStatus: 200   runtime: stub
  hasOpenai: false   keyFingerprint: false   (ffmpeg missing: expected in this container)
```

Two live reads off that instance, and off a second one started with `AGENTFORGE_SERVER=1`, a wrap key
and a trusted origin:

```
desk    GET /api/v1/components -> {"id":"anydoc","version":"0.2.4","auto":false,"managed":false,
                                   "state":"ready","source":"bundled","bytes":0}
server  GET /api/v1/components -> {"id":"anydoc","version":"0.2.4","auto":false,"managed":true,
                                   "state":"ready","source":"bundled","bytes":0}
```

The CLI against the server instance's data directory printed
`mode: server (AGENTFORGE_SERVER=1)` and `ok anydoc@0.2.4 — bundled with the app`, and reported the
managed root correctly with and without `AGENTFORGE_COMPONENTS_DIR` set.

`POST /api/v1/components/install/stream` on the server instance answered 403, but **without a
session**, so that 403 is the session gate rather than this phase's refusal; the handler-level
`install_disabled` is asserted directly in `packages/host/src/handlers/components.test.ts` and is
live test 11. The pstack verifier and mapper halves of the skill live in kyo's Cursor plugin rather
than in this repository, so only kyo can run those, and no UI was driven here.

---

## 8. Open items this phase leaves

1. **`ffmpeg` is still not a component.** It is the next entry the manifest was designed for, and the
   Dockerfile installs nothing for it today. When it becomes one, it joins `COMPONENT_IDS`, and the
   server test asserting `SERVER_COMPONENT_IDS === COMPONENT_IDS` is what forces the decision about
   the image to be made rather than skipped.
2. **The renderer has no "what this server has" surface.** `managed` makes the hosted app say nothing
   instead of offering an install, which is right, but a tenant who wonders why a scanned PDF read
   poorly has nowhere to look. A read-only row in settings, fed by the route that already answers, is
   small and was left out of this phase deliberately.
3. **Nothing alerts when the manifest moves ahead of the image.** A version bump lands in
   `manifest.ts`, and only the next rebuild picks it up; no check compares a running container's
   component versions against the manifest on `main`. `components.sh install` does **not** cover this
   gap — it fetches only what does not load, so it will skip a component whose older bundled copy is
   working fine. Closing it properly means a deploy-time or monitoring check, not a wider `install`.
4. **H3 is satisfiable, not signed off.** The mount option is an operator action on the CVM (live test
   13), not a code change, and the runbook now says so in §4.
5. **There is no integrity check at load time, only at install time.** The sha512 in `manifest.ts`
   is verified before a byte reaches the final directory, and the completion marker is written last,
   but `loadDownloadedAnydoc` then `createRequire`s whatever is under the marker without re-hashing
   it. Anyone who can write into the components root can therefore get code executed in the host
   process. This is pre-existing and identical on the desk; what Phase 7 changes is the exposure — on
   a server that root is `/opt/agentforge/components`, a volume no tenant can write to and which the
   app itself only writes during an operator-run install, whereas the tenant volume is now refused
   outright. Re-verifying at load, or signing the marker, is the real fix and was not in scope here.
6. **The components volume is not in the backup set.** `backup.sh` already excludes `components/`
   under `/data` as re-downloadable, and the new volume is the same kind of content, so it is excluded
   by simply not being `/data`. Worth a line in the runbook if the volume ever holds anything that is
   not re-downloadable from the manifest.
