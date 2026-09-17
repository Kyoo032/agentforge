# Usage

Usage is the desk spend and this-key wallet page at `/usage`. It is a bottom-rail link next to Workspaces and Settings — not a product mode. Day / Week / Month stacked bars and spend-by-model live here; Settings keeps a compact this-key strip and Open Usage.

## Sub-features

- `usage-open-rail` opens Usage from the left rail (`usage-link`) or from the Settings strip (`usage-panel` → `usage-open`). Collapsed rail shows the icon only. Active when the path starts with `/usage`. The page root is `usage-page`.
- `usage-range` toggles Day / Week / Month (`usage-range-day` | `usage-range-week` | `usage-range-month`). Default Day. Changing the range refetches `GET /api/v1/usage?range=…`.
- `usage-chart` shows stacked spend-by-model bars (`usage-range-chart`) or one of **two** empty states, both on `usage-range-empty`: “No {productName} runs in this range.” when the window holds nothing (`apps/web/components/usage-range-chart.tsx:54-60`), and “Runs in this range are not priced yet.” when there are runs but no catalog price (`:61-67`). Match the testid, not either sentence — both are hardcoded English even on an `id` desk. No chart library.
- `usage-this-key` shows the this-key wallet card on `/usage` (and the slim strip inside `usage-panel` on Settings), with `usage-key-meter` under it when the gateway answered. Cloud / no key: the needs-key line. Desk card is `usage-desk-range`; by-model list is `usage-by-model` on this page only, one `usage-model-row-<model>` per row. Range toggle sits in the page header (`usage-range`). Do not treat the first-paint “Loading…” as empty spend.

## How to get to it (user POV)

- Choose Usage on the left rail (`usage-link`), expanded or collapsed (`Use`).
- From Settings, follow Open Usage (`usage-open`).
- Open `/usage` directly.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- Do **not** paste a gateway key unless the operator asked.

- **Rail.** `usage-link` is visible with Workspaces / Settings (not among `mode-*`). Click it. URL matches `/usage`. Heading Usage is visible.
- **From Settings.** On `/settings`, `usage-open` is visible. Click it. URL matches `/usage`.
- **Range.** `usage-range` is visible. Default control is Day (`usage-range-day` has `aria-pressed="true"`). Click Week / Month / Day; each click fires exactly one `GET /api/v1/usage?range=<id>` and flips `aria-pressed` (loading may flash). Equal `usage-desk-range` totals across all three is **expected**, not a stuck fetch: the frames are 14 days / 8 weeks / 6 months (`packages/core/src/gateway/account.ts:515-539`), so a desk whose runs are all recent lands every run in the newest bucket of each. Only the chart's bucket count and labels change.
- **Empty / Cloud.** With no key and no priced runs, `usage-this-key` shows the needs-key line (`usage.thisKey.needsKey`: `Paste a gateway key to see spend.` on `en`, `Tempel kunci gateway untuk melihat pemakaian.` on `id` — do not string-match the English on an `id` desk) and `usage-key-meter` has count 0: the meter only renders for `thisKey.status === "ok"` (`apps/web/components/usage-panel.tsx:86-89`). Either `usage-range-empty` or `usage-range-chart` is visible — do not require priced bars, and do not require the empty state either: a keyless desk with local priced runs still draws a chart.
- **Live (Windows, key saved, read-only).** `usage-this-key` shows `$` used (or Unlimited / error). `usage-desk-range` shows desk display and model count. If this desk has runs in range, `usage-range-chart` and `usage-by-model` show spend.
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), this view reads `Pemakaian`, the range toggle `Hari` / `Minggu` / `Bulan`, and `Kunci ini`. Testids are locale-invariant.
- **IDE proof.** Screenshot under `evidence/usage/<run-id>/` with range toggle + chart or empty.
- **Cloud.** Same via `foundation.spec.ts` after Settings checks. Do not paste a key.

## Gotchas

- `/usage` is exempt from the hidden-mode redirect (`packages/core/src/agents/product-modes.ts:130-137`). A desk that hides every job mode still opens Usage; that is not a leak.
- The chart's empty copy, its `aria-label` and its bar tooltips are hardcoded English (`apps/web/components/usage-range-chart.tsx:56-66`, `:92`, `:152-154`) while `usage.chart.empty` / `unpriced` / `aria` / `barTitle` sit unused in both catalogs. Record it, do not work around it — see `docs/internal/unreleased.md`.
- Usage is not in `PRODUCT_MODES`. Do not hunt for `mode-usage`.
- Desk estimate and this-key wallet will not match (footer note). Chat chips `chat-usage` / `chat-context` stay on Chat.
- Settings no longer hosts `usage-by-model` or `usage-desk-range`. Assert those on `/usage` only.
