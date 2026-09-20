# Build

**Parked / verified-unreachable (GTM).** Custom-agent Build is not a product surface. `/studio/new` and `/agents` redirect to Chat. `mode-agents` count is 0. `settings-build-link` count is 0. The renderer half is **gone**, not parked: there is no Studio page component left in `apps/web` (grep `save-soul|agent-prompt|create-agent` → 0 hits) and `apps/web/app/` holds only `fonts/` and `globals.css`. The host still exposes agent CRUD (`packages/host/src/router.ts:331-339`), so un-parking means rebuilding UI against surviving routes — not un-hiding a page. Do not treat the redirect as a product regression.

## Sub-features

- `build-parked` — navigating `/studio/new` or `/agents` lands on Chat.

## How to get to it (user POV)

- You cannot. There is no Agents tab and no Build link in Settings.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.

- **Redirect.** Go to `/studio/new`. URL becomes `/chat` (15s). `mode-chat` is visible. `create-agent` count is 0.
- **Agents URL.** Go to `/agents`. URL becomes `/chat`. `mode-agents` count is 0.
- Do not click Create. Do not unlock modes via a hidden agent.

## Gotchas

- The redirect is React Router client-side (`apps/web/src/App.tsx:171-172`) and sits next to a catch-all `*` → `/chat` at `:170`. Landing on Chat therefore proves the route is unhandled, not that a dedicated park rule fired — pair the URL assert with `create-agent` count 0.
- Playwright `/studio/**` matching `/studio/new` is irrelevant while the layout redirects.
- Default already has job modes. Missing Images on Default is a fail, not a reason to open Studio.
- A later “show Build again” pass should un-park this file instead of inventing a new feature id.
