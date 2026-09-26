# Map — App locale: boot freeze and the run harness

Last verified: 2026-09-26 for the onboarding reason sentence (`onboarding.gate.invalidKey` now reads "That key
didn't work. Check it at Toko Token and paste it again."). The rest of this page was last verified 2026-09-23
at d4561b8 + uncommitted tree for the run harness (`localeForRun`, the new per-request locale on the hosted
server, the Channel 2 line), the Failure modes row it adds, the gotchas that changed with it, and the `common`
parity gotcha. Not driven: host change, needs a `:3000` restart, and only the hosted server feels it.
Everything else was last verified 2026-09-20 at a053245 + the Phase 4 branch
`feat/web-phase4-tenant-secrets-rcbu9c`.

## Overview

Two locales, one setting. **The UI locale** decides what the chrome says; **the run locale** decides what
language the model writes in. On a desk both come from one machine-wide owner setting (`en` or `id`), both are
**frozen at boot** rather than switched live, and each side keeps its own frozen copy — the renderer in
`apps/web/lib/i18n.ts`, the host in `packages/host/src/locale-boot.ts`.

The freeze is the design, not an oversight: reloading the renderer does not restart the host process, so a live
switch would leave in-flight runs and server state split between two languages mid-session.

**Phase 4 made the choice per user, and only the hosted server feels it.** A person's language is stored
against their portal user id inside their tenant's settings payload, under `users` on `SettingsFileV2`
(`packages/host/src/settings-store.ts:186-196`).
`loadUserLocale` reads it (`packages/host/src/settings-store.ts:582-588`).
On a desk nothing changed by construction: `saveUserLocale`
(`packages/host/src/settings-store.ts:598-613`) also writes the install's `locale`, which is what
`getBootLocale()` freezes, so the boot freeze and the Restart banner behave exactly as they did. In server
mode it does not write the install's locale — one tenant's user must not set the language every other
tenant's process boots in — and nothing is frozen per user, so a change applies on the next request and the
Restart banner never appears (`localePayload`, `packages/host/src/locale-boot.ts:55-61`;
`applySavedLocaleAsBoot` is a no-op there, `:34-40`). Since 2026-09-23 the hosted server also **runs** every
mode in that person's language, not only Chat: each request carries it (see "The run harness" below).

## How it works

### The locale value

`AppLocale = "en" | "id"`, `DEFAULT_APP_LOCALE = "en"`, `parseAppLocale` maps anything unknown (including
`"ID"`, `"fr"`, `undefined`) to `en` (`packages/core/src/locale.ts`, pinned by
`packages/core/src/locale.test.ts`). It is **not a per-desk secret**: it sits beside the workspaces rather than inside one, as the top-level
`locale` field of the settings envelope, with each user's own choice under `users`
(`SettingsFileV2`, `packages/host/src/settings-store.ts:186-196`). There is deliberately **no env override**: `AGENTFORGE_LOCALE` is
not read on the boot path (`packages/host/src/locale-boot.ts:8-9`), asserted at
`packages/host/src/locale-boot.test.ts:45`.

### Setting it, and the restart

1. The Settings select (`settings-locale`, `apps/web/components/settings-page.tsx:313`) validates with
   `isAppLocale`, sets `savedLocale` optimistically, and POSTs `/api/v1/settings { locale }` (`:219-229`).
2. `handlePostSettings` (`packages/host/src/handlers/settings.ts:207-283`) validates the value with
   `isAppLocale` and calls `saveUserLocale(tenant, …)`
   (`packages/host/src/handlers/settings.ts:215-222`) — and does **not** touch the frozen boot locale.
3. Every settings response carries `...localePayload(tenant)` (`packages/host/src/locale-boot.ts:55-61`):
   `{ locale: getBootLocale(), savedLocale: getSavedLocale() }`. `getBootLocale` is cached from the first read;
   `getSavedLocale` always re-reads disk. Those two values differing is the entire signal.
4. The restart banner renders only while `savedLocale !== locale` (`settings-locale-restart`,
   `apps/web/components/settings-page.tsx:321-333`).
5. The button (`settings-locale-restart-button`, `:326`) does three things in order (`:255-276`): POST
   `/api/v1/settings/apply-locale` → `applySavedLocaleAsBoot()` re-reads disk and re-freezes the host
   (`packages/host/src/locale-boot.ts:34-40`); `applyLocale(applied.locale)` re-freezes the renderer and sets
   `document.documentElement.lang`; then `relaunchDesktopApp()` to actually restart the process.
6. If the relaunch is refused — webdev has no bridge, or Electron is installing an update / already exiting /
   the sender is untrusted — the code dispatches `LOCALE_RESTART_EVENT` as a fallback so the UI still reflects
   the change (`apps/web/components/settings-page.tsx:264-272`). `App.tsx:80-84` listens, bumps `localeEpoch`, re-fetches settings and calls
   `applyLocale` (not `freezeLocale`, which no-ops after the first call).

`freezeLocale` vs `applyLocale` is deliberate: the first is the boot path and is idempotent, the second always
overwrites and "Settings Restart is the only product caller" (`apps/web/lib/i18n.ts:136`).

### What the restart actually changes

Driven `en → id → en` on an isolated webdev desk, 2026-09-17
(`evidence/locale/2026-09-17-cc-map/`):

| Moment | State |
|---|---|
| Select `id` | `savedLocale: "id"`, `locale: "en"`. The banner appears. **Every visible string is still English**, including the `<h1>` and the language help line |
| Press Restart (webdev — the relaunch is refused) | `locale: "id"`, `savedLocale: "id"`, banner gone, `document.documentElement.lang === "id"`, and the whole SPA re-renders in Indonesian without a reload |
| Rail | "PERCAKAPAN / Chat", "MODE KERJA / Dokumen, Riset, Keuangan, Data, Pasar, Hukum, Gambar, Video, Edit, Presentasi", "AKUN / Basis pengetahuan, Ruang kerja, Pemakaian, Pengaturan" — every `mode-*` testid unchanged |
| Chat | `chat-empty` "Anda sudah masuk. Tanya apa saja.", `new-chat` "Chat baru", `composer-text` placeholder "Pesan", `reasoning-effort` options "Mati / Ringan / Normal / Dalam / Ekstra / Maks / Ultra" |
| One job mode (`/finance`) | "Keuangan", "TEMPEL ANGKA", "Uraikan menjadi pos", "POS", "Tambah pos", "PARAMETER (OPSIONAL)" |
| Settings itself | `<h1>` "Pengaturan", kicker "AKUN · DEFAULT", `runtime-status` "Status: Demo luring · belum ada kunci", gateway row "Demo luring · Periksa ulang", reset card "Mulai ulang dari awal" |
| Back to `en` | one more select + Restart returns `locale: "en"` **and** `savedLocale: "en"` |

Two sentences on that screen changed shape on 2026-09-17 and are longer than a 2026-09-15 recipe expects:
`settings.intro` now ends "… Tempel kunci API {gatewayName} dari {gatewayHost} untuk menggunakan chat dan mode
kerja di meja ini." and `settings.privacy` now says "… hanya melalui HTTPS ke {gatewayHost}." Both take the host
from `gatewayHostLabel()` — see [`settings-and-gateway-gate.md`](settings-and-gateway-gate.md).

### UI strings

Catalogs are `apps/web/locales/{en,id}/<namespace>.json`, statically imported and assembled into
`Record<AppLocale, Record<Namespace, MessageTree>>` (`apps/web/lib/i18n.ts:74-123`). 22 namespaces (`:47-70`):
`common, rail, settings, onboarding, chat, documents, research, images, videos, presentation, knowledge,
workspaces, usage, market, data, finance, legal, edit, auth, music, channels, meeting` — roughly 1,500 leaf keys each side.

`t("namespace.path.to.key", vars?)` (`apps/web/lib/i18n.ts:194-201`) resolves through `lookup` (`:149-166`) and
`interpolate` (`:168-176`), which replaces `{name}` placeholders. **Missing keys fail closed**: current locale →
the `en` catalog if the locale is `id` → the raw key string (`:181-184`, pinned at
`apps/web/lib/i18n.test.ts:43`).

**Parity tests** flatten both trees and assert equal key sets, one file per namespace group:
`apps/web/lib/settings-locales.test.ts` (`settings`, `onboarding`, plus a required `reset.*` list and an
assertion that the literal word `RESET` stays untranslated), `account-locales.test.ts` (`knowledge`,
`workspaces`, `usage`, `rail`), `chat-locale-inventory.test.ts` (`chat`, plus a "translates owned copy instead of
copying English" check with a brand allow-list), and one each for `documents`, `research`, `images`, `videos`,
`presentation`, `market` (two files: `market-locale.test.ts` and `market-locale-catalog.test.ts`), `data`,
`finance`, `legal` (`legal-locale-catalog.test.ts`), `edit`. The glob `apps/web/lib/*locale*.test.ts` matches
**14** files at this sha.

### The run harness — how `id` reaches the model

`localeForRun()` (`packages/host/src/run-context.ts:63-65`) reads three places, most specific first:

```ts
return getRunContext()?.locale ?? requestLocale.getStore()?.() ?? getBootLocale();
```

1. **A Chat run's own context.** `RunContext` is an `AsyncLocalStorage` store that only Chat populates —
   `withRunContext({ threadId, agentId, locale }, …)` in `packages/host/src/runs.ts`.
2. **The request's person — hosted only (2026-09-23).** `dispatch` wraps every request that passed the session
   gate in `withRequestLocale(() => sessionLocale({ tenantId, userId }), …)` (`packages/host/src/router.ts:535-538`),
   beside the session and the log context. `sessionLocale` (`packages/host/src/locale-boot.ts:64-70`) is
   `loadUserLocale` for the verified session's tenant and user, with the settings fallback desk named rather
   than the client's workspace cookie, because a person's language is per tenant and per user, never per desk.
   The store holds a reader, not a value (`requestLocale`, `run-context.ts:34`): the settings payload is read
   only when a handler asks, at most once per request (`withRequestLocale`, `:42-51`), and a reader that throws
   answers English and logs `request_locale_unreadable` rather than failing a request that only wanted copy
   (`readOrDefault`, `:53-60`). Before this, every job mode on the hosted server wrote in the process's boot
   locale — the install's, which belongs to nobody in particular.
3. **The frozen boot locale.** Off server mode nothing sets level 2, so the desktop and webdev behave exactly as
   before: every job mode resolves to the boot locale.

There are **two independent locale channels per job call**, and getting one right does not fix the other:

**Channel 1 — the instruction the model reads.** `withOutputLanguage(prompt, surface, locale)`
(`packages/core/src/output-language.ts:76-86`) appends a per-surface en/id rule to the system prompt, guarded by
`prompt.includes(rule)` so a retry cannot double-append. Call sites:

| Surface | Call site |
|---|---|
| documents / finance | `packages/host/src/document-generate.ts:94`, section regen `:247` |
| data | `packages/host/src/data-generate.ts:255` |
| finance | `packages/host/src/finance-generate.ts:209`, the repair `:237`, section regen `:358` and its repair `:373` |
| research | `packages/host/src/research-generate.ts:146` |
| knowledge | `packages/host/src/knowledge-map.ts:136` (brain), `:158` (verifier) |
| edit | `packages/host/src/edit/agent-run.ts:172` |
| videos | `packages/host/src/studio-generate.ts:344` |
| music | a description only, `packages/host/src/studio-generate.ts:452`, and the lyrics draft `:523` — never custom lyrics, which are sung word for word (since 2026-09-23) |

Five surfaces keep their own mechanism instead, and the shared table says so at
`packages/core/src/output-language.ts:105-108`: **Chat** → `withChatOutputLanguage`
(`packages/host/src/runs.ts:162`); **Images** → `withImageOutputLanguage`, which is about text *drawn on the
image* (`packages/host/src/studio-generate.ts:279`); **Presentation** → `presentationLanguageRule` spliced into
the outline and slide templates (`packages/host/src/presentation-generate.ts:72-78`); **Legal** →
`legalUserFacingLanguageInstruction` (defined at `packages/core/src/legal/locale.ts:21-34`, imported at
`packages/core/src/legal/prompts.ts:7` and used at `:44`); **Market** → a `Write in ${language}` line in
`buildWatchSystemPrompt` (`packages/core/src/market/briefing-prompt.ts:115`).

**Channel 2 — the infra copy the model never sees.** Every job call (`collectJobAssistantRun`, and
`collectJobAssistantText`, which wraps it) sets `locale: options.locale ?? localeForRun()` on the
`runtime.execute` input regardless of the prompt (`packages/host/src/job-regen.ts:155`). That `locale` field (`packages/core/src/runtime/types.ts:53`) drives
contact-error text, watchdog and abort copy (`packages/core/src/runtime/stream-watchdog.ts`, `retry.ts`) and stub
replies — localized, but generated by the host, not by the model.

**User-facing error copy.** `gatewayRequiredMessage(surface, locale)`
(`packages/core/src/output-language.ts`; the Research search-key message was removed 2026-09-26) and the 17-key `modeMessage(key, locale)` table (keys at
`packages/core/src/mode-messages.ts:10-33`, lookup at `:104-106`) are looked up at exactly the point a harness
would otherwise throw an English `ApiError`. Both fall back to English for any locale that is not `en` or `id`.

**Gateway error copy is mapped in the renderer, not the host.** `GatewayBlockedError` carries **English-only**
`BLOCKED_MESSAGES` (`packages/host/src/gateway-gate.ts:426-433`) — "English, redacted, and specific enough that a
support ticket says which rule closed the gate" — and `jsonError` emits it flat. The renderer's
`parseGatewayBlocked` reads only `status`, discards that English message for display, and maps through
`gatewayReasonKey` / `gatewayStatusKey` (`apps/web/lib/gateway-gate.ts:123-137`) to
`onboarding.gate.invalidKey|unreachable|error` and `settings.gateway.status.<status>`, resolved from the
catalogs. Driven 2026-09-17: a desk whose key the gateway rejected carries `message: "HTTP 401"` in the payload
while the screen reads "That key didn't work. Check it at Toko Token and paste it again." (`onboarding.gate.invalidKey`).

### Failure modes

| Case | Behaviour |
|---|---|
| Unknown locale value posted | 400 `invalid_request` from `isAppLocale` (`packages/host/src/handlers/settings.ts:215-218`) |
| Hosted user has never chosen a language | `loadUserLocale` falls through to the tenant's own stored locale, then to `en` — never to another tenant's payload (`packages/host/src/settings-store.ts:582-588`) |
| Hosted person's locale cannot be read (an unreadable payload, a wrap-key fault) | the request's locale is English and `request_locale_unreadable` is logged; the request itself still runs (`readOrDefault`, `packages/host/src/run-context.ts:53-60`) |
| Unknown locale reaching `parseAppLocale` | silently `en` |
| Missing catalog key | `id` → `en` → the raw key string; never a crash, never blank |
| Locale saved but not restarted | UI chrome unchanged, model output unchanged, banner shown; `getBootLocale()` still the old value |
| Relaunch refused | `LOCALE_RESTART_EVENT` soft-applies in the renderer only; the **host** keeps its old boot locale unless `apply-locale` succeeded first |
| Harness has Channel 2 but not Channel 1 | timeouts and errors in Indonesian, model output in English — the exact bug the 0.14.26 sweep fixed |

## Where things live

| File | Role |
|---|---|
| `packages/core/src/locale.ts` | `AppLocale`, `parseAppLocale`, `isAppLocale` |
| `packages/host/src/locale-boot.ts` | The host freeze: `getBootLocale`, `getSavedLocale`, `applySavedLocaleAsBoot`, `localePayload`; `sessionLocale`, a hosted request's person |
| `packages/host/src/run-context.ts` | `RunContext`, `withRunContext`, `withRequestLocale`, `localeForRun` |
| `packages/host/src/settings-store.ts:564-572` | `loadOwnerLocale` / `saveOwnerLocale` — the install's locale, still what the desk freezes |
| `packages/host/src/settings-store.ts:582-613` | `loadUserLocale` / `saveUserLocale` — Phase 4, the person's own locale |
| `packages/host/src/handlers/settings.ts` | Save, and `handleApplyLocale` behind `POST /api/v1/settings/apply-locale` (`:206`) |
| `apps/web/lib/i18n.ts` | Catalogs, `t()`, `freezeLocale` / `applyLocale`, `LOCALE_RESTART_EVENT` |
| `apps/web/locales/{en,id}/*.json` | 22 namespaces, ~1,500 keys each |
| `apps/web/components/settings-page.tsx:255-333` | The restart handler, the select, the banner and its button |
| `packages/core/src/output-language.ts` | `withOutputLanguage`, `outputLanguageRule`, `gatewayRequiredMessage` |
| `packages/core/src/mode-messages.ts` | `modeMessage` — empty-result and failure fallbacks |
| `packages/core/src/agents/chat-locale.ts` | Chat's own rule and stub copy |
| `packages/host/src/presentation-locale.ts`, `image-output-locale.ts`, `packages/core/src/legal/locale.ts` | The three surfaces that keep their own tables |
| `packages/host/src/job-regen.ts:155` | Where `locale` joins `runtime.execute` for every job |
| `packages/host/src/router.ts:535-538` | Where a hosted request's locale is set, beside its session |

## Gotchas

- **Two freezes, two freeze points.** The renderer freezes on its first `/api/v1/settings` fetch; the host
  freezes on its first `getBootLocale()` call. They can legitimately disagree for a moment — and after a refused
  relaunch, for much longer.
- **Selecting a language retranslates nothing.** Only `settings-locale-restart-button` calls `applyLocale()`.
  Driven 2026-09-17: after choosing Bahasa Indonesia the `<h1>` still read "Settings" and only the banner
  changed. A recipe that asserts Indonesian anywhere else before pressing the button is testing itself.
- **The soft fallback does not tell the user the restart did not happen.** When the relaunch is refused,
  `LOCALE_RESTART_EVENT` re-renders the UI in the new language, which looks like success. The comment at
  `apps/web/components/settings-page.tsx:266-267` says the fallback exists so "the language change would not look
  like it did nothing" — but the host-side boot locale only moved if `apply-locale` had already succeeded.
  **Worth a finding.**
- **On a desk, `localeForRun()` never consults a run context for jobs.** Only Chat's `withRunContext` in
  `packages/host/src/runs.ts` populates that store, and the per-request layer exists only in server mode. On the
  hosted server a job answers in the signed-in person's language through the request layer (since 2026-09-23;
  `packages/host/src/router-locale.test.ts`, `run-context.test.ts`).
- **Market is the only surface with a client-selectable output language.** `request.language`
  (`packages/core/src/market/watch-schemas.ts:333`, default `"id"`) comes from a dropdown seeded from
  `getLocale()` but overridable per run. Market's *errors* still go through `localeForRun()`. Every other job
  surface is server-side only.
- **Getting the runtime `locale` right does not make the model answer in Indonesian.** Channel 1 and Channel 2
  are separate, and a harness can pass one and fail the other in either direction.
- ~~**The `common` namespace has no parity test.**~~ **Fixed 2026-09-23.** `apps/web/lib/common-locale.test.ts`
  keeps the `en` and `id` key trees of `common` aligned and checks the shared job chrome is translated. The same
  pass added `apps/web/lib/i18n-literal-keys.test.ts`, which scans the renderer for every `t("literal.key")` and
  fails when English or Indonesian has no entry — `t()` returns the raw key for a missing one, which is how
  0.15.0 shipped `data.pasteLabel` printed on the Data paste box. Dynamic keys are out of its reach.
- **No harness-level test asserts the Indonesian rule reaches a built system prompt.** Coverage leans on
  `packages/core/src/output-language.test.ts`'s catalog-parity check plus
  `packages/host/src/job-regen.test.ts:74-81`'s runtime-locale check; a grep of the per-harness
  `*-generate.test.ts` files for `locale` returns nothing. **Finding.**
- **Do not script a count of the parity files.** The glob matches 14 files at this sha (it was 13 before Market
  gained a second catalog test), and those files hold ~40 `it()` cases; more locale tests live outside the glob
  in `packages/core` and `packages/host`.
- **Electron relaunch avoids `taskkill /T`** because Electron's relauncher is a detached child
  (`apps/desktop/lifecycle.cjs:55-59`).

## Verify

`.cursor/skills/verify-agentforge/features/locale.md` is the recipe (select `id`, assert the banner and that
nothing else moved, press the button, walk the rail, Chat and one job mode, restore `en` and confirm **both**
`locale` and `savedLocale` are back); `features/settings.md` covers the same select as part of the Settings walk.
Drive it on your own isolated desk — leaving someone else's app in `id` is a visible change.

Testids: `settings-locale` (`apps/web/components/settings-page.tsx:313`), `settings-locale-restart` (`:321`),
`settings-locale-restart-button` (`:326`). They are locale-invariant; so is every `mode-*` id. The one string a
recipe should not match by element text is `reasoning-effort` — the label "Berpikir" sits outside the testid, and
the element itself reads only the seven option names.

Tests: `packages/core/src/locale.test.ts`; `packages/host/src/locale-boot.test.ts` (freeze holds against a later
save; Restart re-freezes); `apps/web/lib/i18n.test.ts` (freeze idempotence, `applyLocale` overwrite, fails closed
on a missing key at `:43`); `packages/core/src/output-language.test.ts` (rule appended once and idempotent, every
surface string byte-identical to the renderer catalogs, distinct en/id, unknown locale → English);
`packages/core/src/mode-messages.test.ts`; `packages/core/src/agents/chat-locale.test.ts`;
`packages/host/src/job-regen.test.ts:74-81` (the locale-threading contract, both inside and outside a run
context); `packages/host/src/image-output-locale.test.ts`; and the 14 `apps/web/lib/*locale*.test.ts` parity
files.

## Why

**Why the locale is frozen at boot instead of switched live.** `[Direct]` the comment at
`packages/host/src/locale-boot.ts:26-33`: "Reloading the renderer does not restart this process (webdev or
packaged IPC), so boot locale must be re-read from disk here." `[Inferred]` the stronger reason — that a live
switch would split an in-flight run's prompt, its error copy and its UI between two languages — follows from
`localeForRun()` feeding both the system prompt and `runtime.execute`'s `locale`, but no source states it in those
words. **Confidence: high for the mechanism, medium for the rationale.**

**Why the gateway 403 message is English on the host and localized in the renderer.** `[Direct]` the comment at
`packages/host/src/gateway-gate.ts:405`: the blocked messages are "English, redacted, and specific enough that a
support ticket says which rule closed the gate". `[Supported]` the renderer independently re-derives copy from
`status` alone (`apps/web/lib/gateway-gate.ts:123-137`), so the host's string is a log and support artifact, not
display copy; driven on 2026-09-17, a rejected key showed the localized sentence on screen while the payload
carried `"HTTP 401"`. **Confidence: high.**

**Why some surfaces keep their own locale tables.** `[Direct]` `packages/core/src/output-language.ts:105-108` names
Legal and Presentation explicitly: Legal keeps its own `stubError`, Presentation keeps
`presentationGatewayMessage` host-side. `[Inferred]` Images is separate for a different reason —
`withImageOutputLanguage` governs text rendered *into* the image, which is not the same decision as the language
of a written answer. **Confidence: high for Legal and Presentation, medium for Images.**

**Why the job harnesses needed teaching at all.** `[Direct]` `8831bc4`'s commit body: "Locale sweep: every mode
now switches with id. Catalogs were already complete; the components and job harnesses that bypassed them are
fixed across Chat, Presentation, Documents, Research, Finance, Data, Market, Legal, Images, Videos and Edit, plus
default thread titles, retry and watchdog copy." `[Direct]` `4db009a` is the commit that added
`packages/core/src/output-language.ts` and wired `withOutputLanguage` into the first eight harnesses. So the
catalogs were never the gap — the gap was code paths that never consulted them. **Confidence: high.**
