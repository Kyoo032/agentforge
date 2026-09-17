# Components (first-run installer)

Native dependencies the app installs by itself: today only `anydoc`, the local document reader. How it works is in [`docs/internal/maps/component-installer.md`](../../../../docs/internal/maps/component-installer.md). Nothing here needs a gateway key, and nothing here may ever ask the owner to run a command.

## Sub-features

- `components-status` `GET /api/v1/components` → one row per component: `state` (`ready | missing | installing | failed | unsupported`), `source` (`bundled | downloaded | null`), `auto`, `bytes`.
- `components-install` `POST /api/v1/components/install/stream` with `{ "id": "anydoc" }` → `job.phase` per stage (`check, download, verify, unpack, probe, marker`), `job.step` download bytes, `job.done` / `job.error`.
- `components-onboarding` the panel `component-setup` inside `onboarding-setup-check`, started without a click.
- `components-silent` the same run with no UI on a desk that is already past onboarding.

## How to get to it (user POV)

Install the app and open it. On the first screen, under the key form, **Setting up DPSBuddy** lists six steps with a progress bar, finishes with a ready line and folds away. The owner presses nothing. If the machine is offline the panel says so, offers **Try again**, and says the app works without it; the key form stays usable throughout. On a machine where the reader shipped inside the app, the panel never appears.

## Driving it with the DPSBuddy harness

1. Doctor the instance. `curl -s http://127.0.0.1:3000/api/v1/components` — expect 200 and one `anydoc` row. A 404 means `:3000` predates the route: report “restart :3000”, do not start another server.
2. `state: "ready", source: "bundled"` is the normal answer on webdev and on a packed Windows build; then `component-setup` must be **absent** from onboarding. Record that as the result.
3. To see the download route, it needs a host where the bundled module does not load (a packed macOS build, or a throwaway checkout without `node_modules/@firecrawl`) and a throwaway `AGENTFORGE_DATA_DIR`. Expect `state: "missing", auto: true`, then on the onboarding screen `component-setup` → each `component-setup-stage-<id>` reaching its check mark → `component-setup-done`. Side effects to capture: `<dataDir>/components/anydoc/<version>/.component-complete.json`, the tail of `<dataDir>/logs/components.log`, and `GET /api/v1/components` now `ready` / `downloaded`.
4. Second launch: the POST answers every stage `skipped` and makes no network call.
5. Proof that it matters: upload a `.pptx` on `/knowledge` (`knowledge-file`) — it indexes with the component, and is refused as unsupported without it.
6. Source check when no such host is at hand: `packages/host/src/components/*.test.ts`, `apps/web/lib/components-client.test.ts`, and one real install into a temp data dir (see the map's Gotchas).

## Gotchas

- Under `AGENTFORGE_RUNTIME=stub` (Cloud, Playwright) `auto` is `false` and the panel renders nothing. That is the design, not a failure.
- `component-setup-error` with `integrity_mismatch` is never retried silently — treat it as a finding, not a flake.
- `busy` means another tab or the silent mount is already installing; the panel says so and re-polls.
- Start over (`settings-reset-all-submit`) deletes the downloaded copy; the next onboarding fetches it again. Drive that only on a throwaway data dir.
- ffmpeg is **not** a component yet; `ffmpeg-setup-notice` is still the manual path and is tracked as the next manifest entry.
