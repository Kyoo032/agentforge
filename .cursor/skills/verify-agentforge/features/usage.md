# Usage

Usage is the desk spend and this-key wallet page at `/usage`. It is a bottom-rail link next to Workspaces and Settings — not a product mode. Day / Week / Month stacked bars and spend-by-model live here; Settings keeps a compact this-key strip and Open Usage.

## Sub-features

- `usage-open-rail` opens Usage from the left rail (`usage-link`) or Settings (`usage-open`). Collapsed rail shows `Use`. Active when the path starts with `/usage`.
- `usage-range` toggles Day / Week / Month (`usage-range-day` | `usage-range-week` | `usage-range-month`). Default Day. Changing the range refetches `GET /api/v1/usage?range=…`.
- `usage-chart` shows stacked spend-by-model bars (`usage-range-chart`) or empty copy (`usage-range-empty`: “No {productName} runs in this range.”). No chart library.
- `usage-this-key` shows the this-key strip + meter on `/usage` (and the slim strip on Settings). Cloud / no key: “Paste a gateway key…”. Desk line is `usage-desk-range`; by-model list is `usage-by-model` on this page only.

## How to get to it (user POV)

- Choose Usage on the left rail (`usage-link`), expanded or collapsed (`Use`).
- From Settings, follow Open Usage (`usage-open`).
- Open `/usage` directly.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- Do **not** paste a gateway key unless the operator asked.

- **Rail.** `usage-link` is visible with Workspaces / Settings (not among `mode-*`). Click it. URL matches `/usage`. Heading Usage is visible.
- **From Settings.** On `/settings`, `usage-open` is visible. Click it. URL matches `/usage`.
- **Range.** `usage-range` is visible. Default control is Day (`usage-range-day` pressed). Click Week / Month; the page refetches (loading may flash).
- **Empty / Cloud.** With no key and no priced runs, `usage-this-key` contains `Paste a gateway key`. Either `usage-range-empty` or `usage-range-chart` is visible — do not require priced bars.
- **Live (Windows, key saved, read-only).** `usage-this-key` shows `$` used (or Unlimited / error). `usage-desk-range` shows desk display and model count. If this desk has runs in range, `usage-range-chart` and `usage-by-model` show spend.
- **IDE proof.** Screenshot under `evidence/usage/<run-id>/` with range toggle + chart or empty.
- **Cloud.** Same via `foundation.spec.ts` after Settings checks. Do not paste a key.

## Gotchas

- Usage is not in `PRODUCT_MODES`. Do not hunt for `mode-usage`.
- Desk estimate and this-key wallet will not match (footer note). Chat chips `chat-usage` / `chat-context` stay on Chat.
- Settings no longer hosts `usage-by-model` or `usage-desk-estimate`. Assert those on `/usage` only.
