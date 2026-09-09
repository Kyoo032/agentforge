# Build

**Parked / verified-unreachable (GTM).** Custom-agent Build is not a product surface. `/studio/new` and `/studio/<uuid>` redirect to Chat. `mode-agents` count is 0. `settings-build-link` count is 0. Studio files remain in the tree for a later pass — do not treat the redirect as a product regression.

## Sub-features

- `build-parked` — navigating `/studio/new` or `/agents` lands on Chat.

## How to get to it (user POV)

- You cannot. There is no Agents tab and no Build link in Settings.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.

- **Redirect.** Go to `/studio/new`. URL becomes `/chat` (15s). `mode-chat` is visible. `create-agent` count is 0.
- **Agents URL.** Go to `/agents`. URL becomes `/chat`. `mode-agents` count is 0.
- Do not click Create. Do not unlock modes via a hidden agent.

## Gotchas

- Playwright `/studio/**` matching `/studio/new` is irrelevant while the layout redirects.
- Default already has job modes. Missing Images on Default is a fail, not a reason to open Studio.
- A later “show Build again” pass should un-park this file instead of inventing a new feature id.
