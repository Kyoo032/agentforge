# Subsystem maps

**How it works.** One page per subsystem: user action → code path → where to fix. These are the recorded output of the pstack `how` mapper (and, where a decision needs a record, `why`). pstack prints to chat and writes nothing, so the map only exists because it is written here.

The sibling half of the map is **where to press**: `.cursor/skills/verify-agentforge/features/<feature>.md`, user POV, owned by the verify skill. A feature file links its map page; a map page names the feature file that verifies it. Neither file is allowed to invent the other's job.

[`desktop-pack-routes.md`](desktop-pack-routes.md) documents a **frozen** route: the desktop app is maintenance-only at 0.14.27 ([`../web-pivot-2026-09-18.md`](../web-pivot-2026-09-18.md)), so that page stays accurate for maintenance cuts and is not expected to grow.

> **A map that disagrees with the code is fixed the same day or deleted.** A stale map is worse than none (`AGENTS.md`, Harness). If you touch a subsystem, re-run the relevant part of `how` and refresh its page in the same PR.

## Convention

One file per subsystem, `docs/internal/maps/<subsystem>.md`. A **single H1 document, edited in place** — not append-only like a changelog. When the code moves, rewrite the affected section and bump the verified line; do not stack a new dated block on top of a stale one.

Under the H1, one line:

```
Last verified: <YYYY-MM-DD> at <short sha>
```

That is the claim being made: at that commit, a human or agent read the cited lines and they said this. If you cannot re-verify, delete the page.

Sections, in this order:

| Section | Contains |
|---|---|
| `Overview` | Two or three sentences: what the subsystem is, what it is for, what it is not. |
| `How it works` | The spine. User action → code path with file paths and function / route names → failure modes. Same shape as the 0.14-changelog `## how — Chat send (pstack)` precedent, expanded. |
| `Where things live` | Table of file → role. Only the files someone would need to start working here. |
| `Gotchas` | Non-obvious behaviour, historical artifacts, the things a newcomer gets wrong. |
| `Verify` | The `verify-agentforge` feature file that proves this page, and the testids or checks that do the proving. |
| `Why` *(optional)* | Decisions that need a record, in synthesizer shape: claim, source, confidence. Only where sources exist. |

Rules that keep these honest:

- **Cite `file:line`.** A claim without a citation is a guess. Paths are repo-root-relative with forward slashes.
- **Confidence is marked** in `Why`: `[Direct]` (one explicit source), `[Supported]` (several indirect items converging), `[Inferred]` (hedged, with the inference chain shown). Never cite code as evidence for its own intent.
- **Add `Why` only where a decision needs a record** and a source exists — a commit message, a changelog entry, `AGENTS.md`, a PR. No sources, no `Why` section.
- **Testids are DOM testids.** Sub-feature names in the verify skill (`chat-send`, `chat-probe`) are recipe names, not `data-testid` values; say which you mean.
- **Read-only.** `how` runs never change product code. A product bug a mapping run finds is a finding for `docs/internal/unreleased.md`, not a fix in the map PR.
- **Cite a symbol, not just a number.** A bare `file:123` rots the next time anything above it moves. Name
  the function, constant or heading in the same sentence and let the line number be the hint that finds
  it — `handlePostSettings` (`packages/host/src/handlers/settings.ts:138`), not `settings.ts:138` alone.
  That is what makes the rot check below able to tell a moved line from a wrong claim, and what lets a
  reader recover when both have drifted.
- **Line endings are LF.** Every file in this tree is committed with LF; an editor set to write CRLF turns
  a one-line correction into a whole-file diff.

## Checking for rot

```sh
node scripts/map-rot.mjs          # these pages plus .cursor/skills/verify-agentforge/
node scripts/map-rot.mjs --all    # every .md in the repo
```

It reads every `file:line` citation and reports two kinds of finding. **HARD** — the cited path does not
exist, or the cited line is past the end of the file — is always wrong and exits non-zero. **SOFT** — the
cited range names none of the distinctive symbols the sentence around it claims — is a lead, not a verdict:
a page may legitimately cite a call site rather than a definition. Read every soft finding before
dismissing it; that is the shape most drift takes.

The check is mechanical. It cannot tell you that a page describes behaviour the code no longer has, which
is the failure that actually costs someone an afternoon. Only re-reading the cited lines does that.

**It also under-reports pure line drift, and you should assume it does.** A citation whose code simply
moved down the file still points at a real line in a real file, so it is not HARD, and SOFT only fires
when the surrounding sentence carries a distinctive backticked identifier that the cited range no longer
names. On 2026-09-20, after three Phase 3 lanes merged in one afternoon, 63 citations across 12 pages
pointed at moved code and this script flagged 9 of them. So **"0 hard" means "nothing is provably
broken", never "nothing has drifted"**. After a merge that touches code a page cites, re-anchor by
diffing the old and new versions of each changed file and mapping the cited lines through, rather than
by running the script and reading the exit code.

`scripts/map-drift.mjs` does exactly that re-anchoring:

```sh
node scripts/map-drift.mjs <the sha on the Last verified line>          # report
node scripts/map-drift.mjs <that sha> HEAD --write                      # re-anchor, then bump the line
```

It maps every citation into a file that changed between the two refs through the diff, leaves alone
any line the newer ref itself wrote, and reports as **UNMAPPED** each citation whose line was deleted
or rewritten — those need a person, because the sentence around them may no longer be true. It is not
idempotent: run it once, from the recorded sha, then bump `Last verified:`. Run it again from the new
sha and a settled tree reports zero.

## Pages

| Page | Subsystem | Verified by |
|---|---|---|
| [`channels.md`](channels.md) | Channels: Telegram bot token, desk channel store, send and poll, pinned egress | `features/channels.md` |
| [`chat-send.md`](chat-send.md) | Chat send: composer → transport → run route → runtime → SSE → rendered message | `features/chat.md` |
| [`settings-and-gateway-gate.md`](settings-and-gateway-gate.md) | Per-desk settings, the host gateway gate, Start over, key pinning | `features/settings.md`, `features/gateway-gate.md` |
| [`locale-boot-and-run-harness.md`](locale-boot-and-run-harness.md) | App locale freeze + restart, and how `id` reaches the model | `features/settings.md`, `features/locale.md` |
| [`knowledge-ingest-loop.md`](knowledge-ingest-loop.md) | Knowledge ingest, injection guard, embedding, retrieval, tenant scoping | `features/knowledge-ingest.md`, `features/knowledge.md` |
| [`desktop-pack-routes.md`](desktop-pack-routes.md) | Windows NSIS worktree route, macOS Docker route, release and updater | `features/desktop.md` |
| [`renderer-media.md`](renderer-media.md) | What a rendered answer may auto-load, and how remote media becomes host-served media | `features/images.md`, `features/videos.md`, `features/security.md` |
| [`media-cost-estimate.md`](media-cost-estimate.md) | The price shown in the Images / Videos studio before generating | `features/images.md`, `features/videos.md` |
| [`finance-parse-and-generate.md`](finance-parse-and-generate.md) | The Finance spine: routes and gates, file import, deterministic parse, compute → narrate → number guard, persist and export | `features/finance.md` |
| [`finance-tasks.md`](finance-tasks.md) | The five Finance tasks: ids, phase graph, the `FinanceTaskModule` contract, the generic runner, the dev-only eval harness | `features/finance.md` |
| [`tenancy-schema.md`](tenancy-schema.md) | The tenant in the schema: `tenants`, `organizations.tenant_id`, migration 0015 and its healer, `TenantContext.tenantId` | no feature file; `packages/db/src/migrate-0015.test.ts` |
| [`tenant-usage-ledger.md`](tenant-usage-ledger.md) | The tenant usage ledger: one `tenant_usage` row per gateway call for every mode, priced at write time in USD micros, migration 0016 | no feature file; `packages/host/src/usage-record.test.ts`, `packages/db/src/migrate-0016.test.ts` |
| [`tenant-resolution.md`](tenant-resolution.md) | Whose data a request may read: `getTenant`, the session seam, first-sign-in provisioning, the scoped workspace cookie, session-bound CSRF | no feature file yet (`features/login.md` lands with the sign-in screen); `packages/host/src/tenant-session.test.ts` |
| [`by-id-routes-and-tenancy-harness.md`](by-id-routes-and-tenancy-harness.md) | The by-id route surface: how each handler is scoped, the `getTenant(request)` sweep, the cross-tenant harness and its completeness assertion, the tenant id on every log line | no feature file (two tenants on a running server needs a portal sign-in); `packages/host/src/tenancy-harness.test.ts` |
| [`chat-sessions-and-rail.md`](chat-sessions-and-rail.md) | Chat sessions in the left rail: list, open, new, delete, desk scoping | `features/chat.md` |
| [`shell-rail-and-workspaces.md`](shell-rail-and-workspaces.md) | The shell around a mode page: rail blocks, desk switcher, `/workspaces`, `/usage` | `features/rail.md`, `features/workspaces.md`, `features/usage.md` |
| [`documents.md`](documents.md) | Documents job: brief + `sourceText` → JSON draft → HTML preview → `.docx` | `features/documents.md`, `features/templates.md` |
| [`research-dossier.md`](research-dossier.md) | Research: plan → search → read → extract → synthesize, streamed as `job.*` | `features/research.md` |
| [`data-analysis.md`](data-analysis.md) | Data: the dataset store, the `run_sql` tool, and host-materialized evidence | `features/data.md` |
| [`presentations.md`](presentations.md) | Presentation: topic → one JSON outline → slide cards → `.pptx` | `features/presentations.md` |
| [`meeting-minutes.md`](meeting-minutes.md) | Meeting: recording intake, ffmpeg chunking, gateway transcription, minutes, the name guard, EN/ID translation | `features/meeting.md` |
| [`legal-matter-run.md`](legal-matter-run.md) | Legal matter: `.docx` intake, role classification, the nine-stage run, deliverables | `features/legal.md` |
| [`edit-timeline.md`](edit-timeline.md) | Edit: the append-only ops log, the agent turn, cards, the review gate, export | `features/edit.md` |
| [`generate-studios.md`](generate-studios.md) | Images and Videos studios: knob snapping, generate, mirror, gallery | `features/images.md`, `features/videos.md` |
| [`music-mode.md`](music-mode.md) | Music: rail desk → describe/custom brief → Suno relay submit + poll → two takes mirrored into the media store | `features/music.md` |
| [`knowledge-flows.md`](knowledge-flows.md) | How each mode and each manual entry point reaches the Knowledge Base: trigger, stored text, retrieval, removal | `features/knowledge-ingest.md`, `features/knowledge.md` |
| [`knowledge-base-page.md`](knowledge-base-page.md) | The `/knowledge` page: Sources, Soul, Memory, Map, and what Chat injects | `features/knowledge.md`, `features/knowledge-graph.md` |
| [`pii-and-key-security.md`](pii-and-key-security.md) | PII masking on the outbound copy, and the gateway key envelope | `features/pii.md`, `features/security.md` |
| [`market-watch.md`](market-watch.md) | Market Watch: rail desk → per-desk watchlist → keyless board → harness packet → guarded briefing | `features/market.md`, `features/rail.md` |
| [`component-installer.md`](component-installer.md) | First-run installer for native components: manifest → stages → hash-checked download → marker | `features/components.md` |
| [`hosted-server-mode.md`](hosted-server-mode.md) | Server mode: the Origin/Host allowlist, CSRF, the HTTP filter, rate limits, masked errors, the redacting logger | `features/security.md` (partial) |
| [`portal-session-auth.md`](portal-session-auth.md) | The portal browser session: mint, verify, refresh, revoke, and the server-mode session gate on `/api` | unit tests under `packages/host/src/auth/` |
| [`database-and-migrations.md`](database-and-migrations.md) | `packages/db`: the data dir, the wrap key, the SQLite connection, the schema, the committed migrations, Start over | `features/settings.md`, `features/data.md` (partial) |
| [`webapp-deploy.md`](webapp-deploy.md) | The hosted deployment stack: image, compose, Caddy, and the build / deploy / backup / restore scripts | none — see `../tencent-cvm-setup.md` §9 |
| [`hosted-security-controls.md`](hosted-security-controls.md) | The hosted perimeter: server mode, admission order, sessions, CSRF, rate limits, response headers, SSRF guard, container hardening | none yet — see the page's Verify section |
