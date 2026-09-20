# Internal docs

Engineering and research notes. Not part of the closed-beta tester surface.

## Current work

| Path | Purpose |
|------|---------|
| [`web-pivot-2026-09-18.md`](web-pivot-2026-09-18.md) | **Direction change (2026-09-18):** DPSBuddy becomes a hosted multi-user web app; desktop frozen at 0.14.27. Decision, rule changes, open decisions, deploy log |

- [`web-data-placement-tencent.md`](web-data-placement-tencent.md) — where each kind of data lives on Tencent Cloud CVM, by migration phase; backup targets.
- [`web-security-spec.md`](web-security-spec.md) — security requirements for the hosted app, with the before-traffic acceptance list.
| [`portal/device-code-login.md`](portal/device-code-login.md) | Device-code login between DPSBuddy and the Toko Token portal: flow, endpoints, tokens, reason codes, client integration plan |
- [`web-phase3-tenancy-spec.md`](web-phase3-tenancy-spec.md) — Phase 3 (tenancy) spec: handler audit, migration 0015, five lanes, open questions.
- [`web-phase3-lane-a.md`](web-phase3-lane-a.md) — Phase 3 lane A: the edit store's required scope argument and the cross-tenant discard bug it closed.
- [`web-phase3-lane-c.md`](web-phase3-lane-c.md) — Phase 3 lane C: the tenant resolved from the browser session, first-sign-in provisioning, the scoped workspace cookie, session-bound CSRF, and what is still open.
- [`web-phase5-plans-billing-decisions.md`](web-phase5-plans-billing-decisions.md) — Phase 5 (plans and billing) decision doc: the five open choices with a recommendation and the cost of each, the metering hole, five lanes. Decides nothing; Kyo answers.
- [`telegram-channels-plan.md`](telegram-channels-plan.md) — Channels: what a channel is, why it is account-rail and not a mode, how the bot token is stored, the egress rule, Phase 1 routes, then the market blast and market trading.
- [`worklog-2026-09-18.md`](worklog-2026-09-18.md) — what landed on day one of the pivot, the known gaps, and where to start next.
- [`handover-2026-09-20.md`](handover-2026-09-20.md) — the running record of everything built, verified and merged on 2026-09-20, one entry per PR, for Kyo to read cold.
| [`portal/schema.md`](portal/schema.md) | Portal control-plane Postgres design: tables, RLS, seat count, wallet |
| [`portal/migrations/`](portal/migrations/README.md) | SQL 0001–0005 for the portal database, run order, rollback notes |
| [`unreleased.md`](unreleased.md) | What is on `main` but not yet in the published exe / dmg; started over at the 0.14.27 cut, and carries the "Still open after the 0.14.27 cut" list |
| [`blockers-2026-09-15.md`](blockers-2026-09-15.md) | Blockers before the 0.14.26 cut, verification owed, security audit findings and follow-ups |
| [`moves.md`](moves.md) | Desktop / shell move log |
| [`maps/`](maps/README.md) | Subsystem maps: user action → code path → where to fix, recorded from the pstack `how` / `why` mapper |

## Changelogs (newest first)

| Path | Purpose |
|------|---------|
| [`0.14.27-changelog.md`](0.14.27-changelog.md) | Cut 2026-09-18, not yet published: Finance task modes, local file extraction, first-run component installer, PII Indonesian identifiers, job model fallback, Market specialists + analyst team, rail sessions, Knowledge hygiene and health |
| [`0.14.26-changelog.md`](0.14.26-changelog.md) | Published 2026-09-15: gateway gate + Start over, id locale sweep, Finance fixes, media cost estimate, security pass |
| [`0.14.25-changelog.md`](0.14.25-changelog.md) | Published 2026-09-12: Market Watch, desk management, Knowledge Phases 0–4 |
| [`0.14.23-changelog.md`](0.14.23-changelog.md) | Published 2026-09-08: Legal mode v1, Knowledge ingest loop, hardening + offline, Videos example clips |
| [`0.14.22-changelog.md`](0.14.22-changelog.md) | Research dossier, Data, Finance, macOS preview |
| [`0.14.21-changelog.md`](0.14.21-changelog.md) | Endpoint URL override and earlier fixes |
| [`0.14.1-changelog.md`](0.14.1-changelog.md) | Everything that must be inside the 0.14.1 setup.exe |
| [`0.14-changelog.md`](0.14-changelog.md) | 0.14 baseline |

## Plans and mode notes

| Path | Purpose |
|------|---------|
| [`research-dossier-analyst-modes-plan.md`](research-dossier-analyst-modes-plan.md) | Research dossier plus Data / Finance analyst modes |
| [`market-mode-plan.md`](market-mode-plan.md) | Market Watch mode |
| [`legal-mode-flow.md`](legal-mode-flow.md) | Legal mode run flow |
| [`legal-mode-contracts.md`](legal-mode-contracts.md) | Legal mode data contracts |
| [`weknora-kb-plan.md`](weknora-kb-plan.md) | Knowledge Base plan (builtin path shipped; WeKnora sidecar not used) |
| [`gateway-model-selection.md`](gateway-model-selection.md) | How models are chosen against the gateway |
| [`research/media-pricing.md`](research/media-pricing.md) | Image / video provider list prices behind the studio cost estimate |
| [`mobile-android-plan.md`](mobile-android-plan.md) | Android client plan (paused) |
| [`ffmpeg-attribution.md`](ffmpeg-attribution.md) | ffmpeg licensing notes for the Edit studio |
| [`mockups/`](mockups/) | UI mockups |
| [`research/`](research/) | Gateway and competitor research |
