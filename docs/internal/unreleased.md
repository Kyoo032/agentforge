# Unreleased changes (after public v0.14.27)

**Purpose:** what is on `main` or on the cut branch but not inside the installers attached to the public **v0.14.27** release on `Kyoo032/DPSBuddy`. The `0.14.27` cut is `e2e477e` on `release/0.14.27` (PR #52, `e8a7118`, plus the version bump), with `apps/desktop/package.json` at `0.14.27`; everything this file used to list has been folded into [`0.14.27-changelog.md`](0.14.27-changelog.md). **0.14.27 is not published yet** — until it is, this file records only what lands *after* that cut. The next cut after it is **`0.14.28`** (per the 2026-09-07 rule; never `0.14.3+`, never `0.15` until Kyo says so). Convention unchanged: at the bump everything listed here is folded into `<version>-changelog.md` and this file starts over. Same rule as every changelog: nothing counts as shipped until it is staged, packed, installed, and driven on the packaged app.

Append-only. When 0.14.28 is published, record the artifact table below, fold any later items into the next changelog, and start this file over.

## Where each published artifact came from

To be filled when 0.14.27 is packed and published — the pack lanes write their shas, sizes and sha256 into the `## Pack + publish` block of [`0.14.27-changelog.md`](0.14.27-changelog.md) first, and the published rows are copied here.

| Artifact | Source | Uploaded (UTC) |
|---|---|---|
| `DPSBuddy-Setup-0.14.27.exe` + `.blockmap` + `latest.yml` | `05e97a5`, worktree `agentforge-pack-0.14.27-05e97a5`, sha256 `D2FCD444…1A45D6`, 102 243 076 bytes, `latest.yml` sha512 `yHNJBKzW…nG9mw==` | *packed 2026-09-18 01:13 UTC, not published* |
| `DPSBuddy-0.14.27-mac-arm64.dmg` / `.zip`, `-x64.dmg` / `.zip` | `6da52d7` (Docker Linux, `--arch all`, third pack — the first two shipped Linux anydoc binaries), `mac-0.14.27.sha256`, arm64 dmg `c2434f49…6b83d` / zip `70e4eab7…68d51`, x64 dmg `edda5e18…29aa1` / zip `16dff901…88d4fa` | *packed 2026-09-18 01:28 UTC, not published* |

Earlier releases: 0.14.26 (`e93c617`, published 2026-09-15 09:18 UTC, 7 assets) and everything before it are recorded in their own changelogs and in this file's history at `e2e477e`.

## Still open after the 0.14.27 cut

Nothing below is closed by 0.14.27. Carried forward as-is.

- [ ] **Packaged bundled-anydoc load.** The 0.14.27 packs carry `anydoc.win32-x64-msvc.node` and `anydoc.darwin-<arch>.node` in `app.asar.unpacked`, but no packed app has been shown to *load* them. Proof owed: `doctor --desktop` plus `GET /api/v1/components` reporting `anydoc` `ready` with `source: "bundled"`.
- [ ] **Any macOS run of the component installer's download route.** Never done. An ad-hoc-signed, non-notarized app should be allowed to `dlopen` a downloaded `.node`; nobody has watched it happen.
- [ ] **The onboarding component panel** (`component-setup`) has never been seen in a browser or on the packaged app — on this desk anydoc is bundled, so it correctly renders nothing.
- [ ] **Webdev drives of the 0.14.27 product work:** Finance tasks, Finance import/export, the Market analyst team, the rail submenus and recent sessions, and `GET /api/v1/components`. The `:3000` host must be restarted after the host/core edits in PR #52 before any of it is drivable (`tsx server.ts` has no watcher).
- [ ] **Playwright `foundation.spec.ts`** against PR #52's tree — owed from GitHub Actions / Cloud. Blocked on 2026-09-18: every Actions run since 2026-09-17 (main, PR #52, PR #53) ends in `startup_failure` / "account is locked due to a billing issue"; no job has started. Clear the billing lock on `Kyoo032`, then `gh run rerun` the e2e workflow on `release/0.14.27`.
- [ ] **Legal:** one live matter run against the gateway (`features/legal.md` steps 4 to 8), and the Word / Excel round-trip of the redline and deviation report. The Legal recipe has still never been driven.
- [ ] **Packaged Windows drive of Start over + the gateway gate** (`doctor --desktop`, `host-status.json` `hasOpenai: false` after sign-out). Pack checklist item 4 of 0.14.26 was never met.
- [x] **Owner install smoke (Windows), 2026-09-18** — Kyo installed `DPSBuddy Setup 0.14.27.exe` (`05e97a5`) and reports it working. Still unticked below because no one has driven the itemised list.
- [ ] **The manual Windows smoke list** from `apps/desktop/platform/windows/AGENTS.md` that no script can do: Ctrl+V and right-click Paste on the onboarding key field, composer clipboard round-trip, the rail-footer update panel, Start over → reset → "Keep my data", model-output links opening the default browser, the model picker on a narrow pane.
- [ ] **Packaged CSP console check** on a packed build (the static half is proven; the DevTools/runtime half is not).
- [ ] **A packaged-app drive from the verify skill** — the 0.14.26 live pass stayed on webdev because a `DPSBuddy.exe` was running.
- [ ] **mac launch smoke on hardware for this build.** The owner closed it for 0.14.26 on 2026-09-15; it is owed again for 0.14.27.
- [ ] **ffmpeg is still a manual install** on both platforms and still shows `ffmpeg-setup-notice`. It is the next component-manifest entry.
- [ ] **The unfixed findings.** 51 unique bugs from the 2026-09-17 mapping pass, 21 from the knowledge-flow pass and 9 from the 2026-09-15 harness pass were logged in this file; the knowledge-path ones were fixed in PR #52 and marked in place, the rest are still live. Read the full lists from this file at `e2e477e`; the harness pass is also tracked as P7–P15 in [`blockers-2026-09-15.md`](blockers-2026-09-15.md), and the five that were fixed are summarised in [`0.14.27-changelog.md`](0.14.27-changelog.md).
- [ ] **Chat card titles.** A Chat thread's title is never regenerated after turn 1 (`threads.ts` `setThreadTitleFromParts`), so a Chat knowledge card keeps its first-turn name.
- [ ] **Housekeeping on the owner's desk:** purge the 37 stub video rows from `data/agentforge.sqlite` so the dev Videos gallery is clean; 104 leftover `edit-idor-<hex>` desks from an older security probe still render in the switcher (each DELETE needs `confirmName` — ask before sweeping).

## Log

- **2026-09-18** — 0.14.27 cut. PR #52 merged (`e8a7118`), version bumped to `0.14.27` (`e2e477e`) on `release/0.14.27`; everything from after the 0.14.26 cut folded into [`0.14.27-changelog.md`](0.14.27-changelog.md) and this file started over. Nothing packed, nothing published.
