# Studio advanced

**Parked / verified-unreachable (GTM).** Post-create soul/tools/model edit lived at `/studio/[agentId]`. That URL now redirects to Chat with Build. Do not drive `save-soul` or treat missing Studio as a regression.

## Sub-features

- `studio-parked` — `/studio/<uuid>` redirects to Chat.

## How to get to it (user POV)

- You cannot. Build is hidden.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.

- **Redirect.** Go to any `/studio/<uuid>`. URL becomes `/chat` (15s). `agent-prompt` count is 0.

## Gotchas

- `/studio/<uuid>` matches the same `/studio/*` rule as `/studio/new` (`apps/web/src/App.tsx:171`); there is no separate agent-id route. Assert `agent-prompt` **and** `save-soul` at count 0 — both were 0 on 2026-09-17.
- Un-park together with [build.md](./build.md) when custom agents return to the product.
