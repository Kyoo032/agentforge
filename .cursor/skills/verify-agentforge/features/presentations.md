# Presentation

Presentation is a job: prompt or starter → slide preview → PPTX download. It is not an in-browser slide editor. Live generate needs a gateway key. Starters load a canned outline without one.

## Sub-features

- `presentations-rail` reaches `/presentations` from `mode-presentations` on Default.
- `presentations-shell` shows `presentations-studio` with `presentations-studio-empty` copy, starter cards, the templates gallery, and the sticky `presentations-studio-prompt-bar`.
- `presentations-gallery` is the shared example gallery (`example-gallery`, six `example-card`s, `example-result`). A click only fills `presentations-prompt` — it never generates.
- `presentations-generate` is the live path (`presentations-prompt` + `presentations-generate` → `POST /api/v1/presentations`). Stub/no-key is HTTP 503 into `presentations-error`.
- `presentations-enhance` rewrites the typed prompt. It is the one control here that answers 200 without a key (`stubEnhancePrompt` short-circuits ahead of the gate, `packages/host/src/handlers/enhance-prompt.ts:45-48`).
- `presentations-source` is the optional Source material box (`-source-toggle`, `-source-text`, `-source-picker`, `-source-clear`, `-source-title`), sent as `sourceText` on both generate and regenerate. It is also what a `*-make-presentation` handoff from Research / Finance / Data / Market / Legal fills.
- `presentations-starter` loads a preview (`presentations-preview`) without a live generate. Slide bullets and notes render markdown via `FormattedText` (same as Chat `message-output`).
- `presentations-studio-model` is the generate-bar chat-catalog dropdown.
- `presentations-regen` on a slide opens `presentations-regen-panel` (prompt, model, attach). Confirm with `presentations-regen-submit`; stub/no-key shows `presentations-error` with a Settings hint.
- `presentations-download` builds a PPTX from the in-memory outline.

## How to get to it (user POV)

- Choose Presentation on the left rail (`mode-presentations`). Default already has the tab.
- Open `http://127.0.0.1:3000/presentations` when the tab is unlocked.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-presentations` is visible on Default.
- Stub proof stops at starters + regen 503. Live generate only if the operator asked and doctor reports `ai`.
- A stub desk cannot show: a real outline, the saved `presentations / draft` artifact, the `Presentation` Knowledge Base work card, or a `*-make-presentation` handoff (the source studios only render their action row after a live run). Record those as verified-unreachable, not as skips.

- **Open Presentation.** Click `mode-presentations`. URL matches `/presentations`. `presentations-studio`, `presentations-studio-empty` and `presentations-studio-prompt-bar` are visible. `presentations-studio-model` is visible immediately but is **empty and disabled until `/api/v1/models` lands** (SKILL.md harness-wide gotcha **G1**) — wait for its option count to go above 0 before reading it (measured 0 → 101, selected `glm-5.3-flash` = `defaults.presentations`).
- **Templates gallery.** `example-card` count is 6 (`presentations-seed-stage-pitch`, `-weekly-operating-review`, `-workshop-opener`, `-ship-day-readout`, `-retro-with-owners`, `-all-hands-recap`). Click one: `presentations-prompt` fills with a multi-hundred-character brief and `example-result` appears. No request is made.
- **Generate without a key.** With `presentations-prompt` non-empty, click `presentations-generate`. `POST /api/v1/presentations` answers **503 `runtime_stub`** and `presentations-error` carries the gateway copy. This is the prompt-bar proof; do not substitute a raw POST.
- **Starter.** `presentations-starter` count is 2. Click the first. `presentations-preview`, one `presentations-slide-title`, six `presentations-slide` and six `presentations-regen` are visible, with a `Notes:` line under each slide. Loading a starter clears `presentations-error` and reveals `presentations-download`. Bullets and notes go through `FormattedText` (`apps/web/components/presentation-preview.tsx:62`, `:86`, `:162`), but **neither shipped starter contains markdown syntax** (`apps/web/lib/job-starters.ts:86-406` — plain sentences in both the `en` and `id` arrays) — a starter drive cannot prove the rendering, only the renderer source can.
- **Regen without a key.** Click `presentations-regen`. `presentations-regen-panel`, `presentations-regen-prompt`, `presentations-regen-model`, and `presentations-regen-attach` are visible. Click `presentations-regen-submit`. `presentations-error` mentions gateway / Settings / API key. `presentations-regen-file` (the hidden multi-file input) also exists, and after the 503 the panel **stays open** and `presentations-preview` survives — the error banner renders at the top of the studio, not inside the panel.
- **Download.** Click `presentations-download` to get a PPTX from the starter (no live model). Observed: `POST /api/v1/presentations/pptx` → 200, `Content-Disposition: attachment; filename="<safeFilename(title)>.pptx"` (id starter: `Northline-Fieldnote-minggu-1-Sep.pptx`, 108 880 bytes).
- **Keep-alive.** Switch to `mode-chat` and back to `mode-presentations`: the deck is still mounted (SKILL.md harness-wide gotcha **G3**). Reload the page: the deck is gone and `presentations-studio-empty` returns. Nothing about a deck is persisted, so a stub run leaves the owner's desk untouched.
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), this view reads `Presentasi`, `Belum ada dek` and `Mulai dari templat` (namespace `presentation.json`, singular; the rail key stays `presentations`). Testids are locale-invariant. The 503 banner is host copy, not renderer copy: `Pembuatan presentasi membutuhkan gateway yang aktif. Tempel kunci API Toko Token di Pengaturan, lalu coba lagi.` — and the `Open Settings` link **only renders on an id desk**, because the English message already contains the word "Settings" and the link condition excludes it (`apps/web/components/presentations-studio.tsx:174`). Match `/gateway/i`, not `/Settings/i`.
- **Cloud.** `apps/web/tests/e2e/foundation.spec.ts:89-103` covers rail → studio → 2 starters → preview → regen panel → 503 on the Default **workspace** rail. It does not touch the gallery, the prompt bar, Download, or Source material.

## Gotchas

- The title card is not a slide. Regen buttons sit on `presentations-slide` rows only.
- The title card has its own testid, `presentations-slide-title`. A "6-slide" starter therefore renders 7 cards and pages read `n / 7` (`total = slides.length + 1`, `apps/web/components/presentation-preview.tsx:113`).
- Regen opens a panel; it does not POST until `presentations-regen-submit`. Stub is HTTP 503.
- Do not POST `/api/v1/presentations` as a substitute for the prompt bar on a live proof.
- `presentations-download` is the one presentations route with **no gateway gate and no tenant** (`packages/host/src/handlers/jobs.ts:170-184`). It answers 200 on a stub desk and would answer 200 with the gate closed. Getting a PPTX is therefore not evidence of a working key.
- A closed gate (403 `gateway_blocked`) does **not** surface here: the flat error body is unreadable to the studio's `errorMessage()` and the banner falls back to the generic "could not generate" string with no Settings link. Expect that, and see `docs/internal/unreleased.md`.
