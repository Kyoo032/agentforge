# Map — PII masking and key security

Last verified: 2026-09-23 at d4561b8 + uncommitted tree for the new rows of § 5 (the sealed portal refresh token
and the hashed session id). Everything else was last verified 2026-09-20 at a053245 + the Phase 4 branch
`feat/web-phase4-tenant-secrets-rcbu9c` (through e37b3a1). The four finance parsers' `guardFinanceInput`
lines were re-read 2026-09-26 at 083f925.

## Overview

Two secrets live on a DPSBuddy desk and neither is allowed to leave it in the clear. The owner's **typed text** may contain personal data, so the host swaps local regex matches for `[email]` / `[phone]` / `[id]` / `[card]` — and, since 2026-09-17, `[nik]` / `[npwp]` / `[account]` — on the way into the model while the persisted transcript keeps the original. The owner's **gateway key** is sealed into `settings.enc` under an AES-256-GCM envelope whose wrapping key never appears in the UI, and the only thing the renderer ever learns about it is a boolean and a 12-hex-character SHA-256 prefix.

The thing to hold onto: **masking is a property of the outbound copy, not of the stored data.** `insertMessage` writes what the owner typed; `createRuntime`'s wrapper masks a shallow copy on its way to `execute`. Nothing ever rewrites the row. The same asymmetry runs the other way for the key: the disk copy is encrypted, the wire copy is a hash, and there is no third copy.

This page is not a crypto review and makes no claim about the strength of the envelope beyond what the code does. It is also not the gateway gate — that is [`settings-and-gateway-gate.md`](settings-and-gateway-gate.md).

## How it works

### 1. The detector — eight kinds, regex only, no classifier

`packages/core/src/security/pii.ts` is the whole scanner. **Eight** kinds and eight tokens as of 2026-09-17 (`PiiKind` at `packages/core/src/security/pii.ts:4`, `PII_MASK` at `:6-15`):

```
email → [email]   phone → [phone]   id → [id]      card → [card]
nik   → [nik]     npwp  → [npwp]    account → [account]   name → [name]
```

The four original patterns (`:23`, `:26`, `:29`, `:32`) are deliberately loose, and `scanPii` (`:158-239`) then throws most of what they catch away:

| Kind | Regex | Accept rule |
|---|---|---|
| email | `:23` | any match, as-is (`:171-176`) |
| phone | `:26` | 10–15 extracted digits **and** `hasPhoneFormatting` — leading `+`/`00` or an internal `[\s().-]` (`:73-75`) — and not `looksLikeAmount` (`:116-119`), and not `slicedFromNumber` (`:131-137`), and no overlap with an earlier finding (`:178-195`) |
| card | `:29` | must pass Luhn (`passesLuhn`, `:39-57`), and an **unseparated** run must also satisfy `bareRunLooksLikeCard` (`:151-156`); a run already claimed by an Indonesian finding is skipped (`:206-209`). Checked at `:197-211` |
| id | `:32` | ≥ 9 digits, not already Luhn-valid at card length, no overlap, and must contain `[-\s]` (`:213-235`) |
| nik / npwp / account / phone (`08xx`) | `packages/core/src/security/pii-id.ts` | `scanIndonesianIds`, run **first** inside `scanPii` (`:167-169`) so a NIK that happens to pass Luhn reads as `[nik]` and not `[card]`. Detector-by-detector rules are in "Finance privacy guard" below |
| name | — | **never produced by `scanPii`.** The token exists in `PII_MASK`; only the Finance column scanner classifies a name column, and even there the cell becomes a pseudonym (`Karyawan N`), not the literal `[name]` (`packages/core/src/finance/pii-scan.ts:90-98`) |

Both of the "must have a separator" rules exist for one reason, stated in the comments at `:72` and `:229-230`: **bare digit runs are quantities, not identities.** A market cap or a share volume in a Finance or Market prompt is 13 digits long and would otherwise come out as `[id]` or `[card]`. `packages/core/src/market/briefing-prompt.test.ts:172-183` pins that behaviour against real briefing text.

**The Indonesian detectors are not Finance-only.** `scanIndonesianIds` was spliced into `scanPii` itself, not gated behind a Finance flag, so every caller of `maskPii` / `maskOutboundRunInput` — Chat, knowledge cards, studio prompts, research and market queries — now masks NIK, NPWP, labelled bank accounts and `08xx` phones too.

`maskPii` (`:253-275`) applies the surviving findings; `maskPiiInParts` (`:277-284`) maps `type: "text"` and `type: "thinking"` parts and leaves `image_url` alone; `maskOutboundRunInput` (`:286-297`) masks `input.version.systemPrompt` and every `history[].parts`, spreading rather than mutating. `KIND_LABEL` (`:241-250`) carries a human sentence for all eight kinds.

### 2. The masking point — inside what `createRuntime` returns

The feature file says "`createRuntime()` masks". That is exactly right, and the call is not in `packages/host` at all:

1. `packages/host/src/runs.ts:282` — `const runtime = createRuntime(settings);`
2. `packages/core/src/runtime/create-runtime.ts:32-40` — builds `AiSdkRuntime` or `StubRuntime` (`:38`) and wraps it in `withToolSecrets(runtime, settings)` (`:39`).
3. `packages/core/src/runtime/create-runtime.ts:11-30` — the wrapper's own `execute` (`:14-28`) calls `runtime.execute(maskOutboundRunInput(input))` at `:26`.
4. `packages/host/src/runs.ts:286` — `await runtime.execute({...})` hits that wrapper, so the mask is applied for **stub and live alike**.

Because it is the wrapper, not the runtime, a future runtime added under `createRuntime` inherits the mask for free; a runtime constructed directly does not.

### 3. Why the transcript keeps the original

Ordering inside `startModalityRun`:

| Step | Line | What it holds |
|---|---|---|
| parse + injection-guard the parts | `packages/host/src/runs.ts:135` | original text, attachments possibly blocked |
| persist the user message | `packages/host/src/runs.ts:251` | **original**, sealed at rest |
| read history back | `packages/host/src/runs.ts:260` | original |
| build the runtime | `packages/host/src/runs.ts:282` | — |
| execute | `packages/host/src/runs.ts:286` | **masked copy** |

`insertMessage` (`packages/host/src/threads.ts:267-286`) writes `content: sealJson(content)` at `:279` — it seals, it does not mask. `listMessages` (`:258-265`) opens the same bytes. So `message-list` renders the email the owner typed and the model saw `[email]`, and no code path exists that could reverse that.

### 4. The injection guard is a different guard

`packages/core/src/security/injection-guard.ts` is unrelated to PII and runs earlier. Five rules (`:18-45`): `ignore-previous` (critical, `:19-24`), `dan` (critical, `:25-29`), `system-delimiter` (critical, `:30-34`), `prompt-leak` (high, `:35-39`), and an Indonesian `id-override` (high, `:40-44`). Before matching, text is NFKC-normalized, stripped of zero-width characters and folded through a Cyrillic/Greek homoglyph map (`:48-58`, `normalizeForScan` at `:64-69`), so `іgnore` with a Cyrillic і still hits.

Two shapes of use:

- **Attachments.** `redactAttachedText` (`:129-138`) finds `--- <filename> ---` blocks (`ATTACH_BLOCK_RE`, `:126`), runs `scanInjection` (`:77-88`) on each body, and replaces a hit with `[Attachment blocked by injection guard (rule: <rule>)]`. `redactAttachedParts` (`:140-147`) maps that over text parts. Chat calls it at `packages/host/src/runs.ts:135`.
- **Everything ingested.** Knowledge sources (`packages/host/src/knowledge.ts:430`), work cards (`packages/host/src/knowledge-ingest.ts:29`), research pages (`packages/host/src/research-generate.ts:150`), and every job's `readSourceText` (`packages/host/src/job-source.ts:12,24`, called from `finance-generate.ts:165`, `data-generate.ts:208`, `document-generate.ts:156`, `presentation-generate.ts:145`) run `scanInjection` on fetched or uploaded text.

One switch turns all of it off: `injectionGuardBypass` on `StoredSecrets` (`packages/core/src/secrets.ts:33`, `:80`), set through `POST /api/v1/settings` (`requestsOperatorOnlySettings`, `packages/host/src/handlers/settings.ts:176-184`), persisted at `packages/host/src/settings-store.ts:132`, and returned to the UI by `maskSecrets`. It is stored only when `true` (`packages/core/src/secrets.ts:230-234`), so the protected state is the default. The comment at `packages/core/src/security/injection-guard.ts:72-76` is explicit that there is no "this looks like a security discussion, skip it" carve-out — the bypass setting is the only escape hatch, on purpose.

Knowledge also masks PII on its own path, because knowledge chunks are FTS plaintext while messages are sealed: `packages/host/src/knowledge-ingest.ts:42` (body) and `:40` (title).

### 5. The envelope

`packages/core/src/crypto/envelope.ts` is the one seal in the product.

- Shape (`:3-12`): `{ v: 1, alg: "aes-256-gcm", n, ct, tag }`, all base64.
- Key (`wrappingKeyFromSecret`, `:14-16`): `sha256(secret)` used directly as the 32-byte AES key. **Not** a password KDF — the inputs are already 32 bytes of randomness (§6), so there is nothing to stretch.
- Encrypt (`:18-31`): 12-byte `randomBytes` nonce, `aes-256-gcm`, plaintext is `JSON.stringify(value)`, `getAuthTag()` → `tag`.
- Decrypt (`:33-41`): `setAuthTag` then `JSON.parse`, so a tampered blob throws rather than returning garbage.
- **Legacy tolerance** (`openPayload`, `:61-66`): when `isEnvelope(stored)` is false (`:43-55`, `:62`), line `:65` returns the value unchanged. That is how rows written by pre-encryption builds still open. It also means a row that *looks* plaintext is trusted as plaintext.

Sealed today:

| Column | Sealed at | Opened at |
|---|---|---|
| `messages.content` | `packages/host/src/threads.ts:279` (`sealJson`, `:17-22`) | `packages/host/src/threads.ts:264` (`openJson`, `:24-33`) |
| `tool_invocations.input` / `output` | `packages/host/src/threads.ts:351-352` | same `openJson` |
| `agent_versions.system_prompt` | `packages/db/src/repos/drizzle-agent-repository.ts:87` (`sealText`, `:16-18`) | `:57` (`openText`, `:20-33`) |
| `settings.enc` (whole file) | `packages/host/src/settings-store.ts:221-227` | `:237-252` |
| `auth_sessions.refresh_sealed` — the portal refresh token behind each hosted session (hosted only, since 2026-09-23, migration 0021) | `sealRefresh`, `packages/host/src/auth/session-secrets.ts:57-65` | `openRefresh`, `:82-102` |

The refresh token is the one sealed value that does **not** use the wrap key directly: its key is
HKDF-SHA256 over the wrap key with info `auth-session-refresh-v1` (`refreshSealingKey`,
`packages/host/src/auth/session-secrets.ts:52-54`), so no other purpose's key opens it, and the sealed payload
names the id digest of its own row, so a blob copied onto another session's row opens as nothing (`:98`). The
access token is never written anywhere. The wrap-key rotation drill re-seals these tokens along with
`settings.enc` (`packages/host/src/wrap-key-rotation.ts:224-238`, `:262-273`). What this adds to the threat
model: the database **and** the wrap key together now refresh every hosted session at the portal
([SR-64](../security-register.md#sr-64)).

Hashed, not sealed: `auth_sessions.id` is `sha256(cookie id)` in lowercase hex since 0021 (`hashSessionId`,
`packages/host/src/auth/session.ts:125`), so a copy of the table replays no session
([SR-60](../security-register.md#sr-60)).

Plaintext on purpose: `threads.title` (`packages/db/src/schema.ts:399`, written unsealed at `packages/host/src/threads.ts:43` and `:252-255`), `agent_versions.model` (`packages/db/src/schema.ts:345`), `runs.usage` / `runs.error` (`packages/db/src/schema.ts:437-438`, written unsealed at `packages/host/src/threads.ts:322-325`), and the key fingerprints themselves.

### 6. The wrap key — three sources, one of them a trap

`getLocalVaultKey()` (`packages/db/src/vault-key.ts:123-135`) is the only consumer:

1. `AGENTFORGE_SECRETS_KEY` if set (`:124-126`).
2. Otherwise `readOrCreateMasterKeyFile()` (`:107-114`): `<localDataDir>/.master-key`, created on first use as `randomBytes(32).toString("hex")` with mode `0o600`. `localDataDir()` (`:6-19`) resolves `AGENTFORGE_SETTINGS_PATH` → `AGENTFORGE_DATA_DIR` → repo `data/`. The file is gitignored at `.gitignore:12`.

`AGENTFORGE_SECRETS_KEY` is the **server** path: on the hosted web app the wrap key comes from the environment or a secret manager, never from a file in the repo and never from keytar — `getLocalVaultKey()` already reads the env first (`packages/db/src/vault-key.ts:123-135`). keytar / the OS keychain is the **Personal desktop** path, not the source of record.

In the **packaged app (desktop, frozen)** the env var is what is set, from the OS keychain: service = product name (`apps/desktop/main.cjs:65`), account `wrap-key` (`:66`), read/minted in `wrapKey()` (`:282-298`) with a legacy-service fallback for upgraded installs (`readLegacyWrapKey`, `:271-280`), then injected at `:620-625` inside `bootstrapPackaged()` — which only runs when `app.isPackaged` (`:815-816`). Webdev therefore never touches keytar.

The trap is `apps/desktop/main.cjs:293-297`: if keytar throws, the catch returns a **fresh random 32-byte key for this process only**, unpersisted. The app boots, but `settings.enc` no longer opens — and rather than crashing, `loadEncryptedPayload` calls `quarantineUnreadableSettings` (`packages/host/src/settings-store.ts:333-354`) and renames the file to `settings.enc.unreadable`. From the owner's side that reads as "my key vanished", and the harness already tells you to note a keytar fallback in evidence.

### 7. `settings.enc`

Phase 4 moved this behind a backend: off server mode it is still `resolve(tenantDataDir(tenantId), "settings.enc")` (`statePath` over `TENANT_STATE_FILENAMES`, `packages/host/src/tenant-state-store.ts:86-88`, `:48-51`), and in server mode it is a `tenant_state` row ([`tenant-secrets-backend.md`](tenant-secrets-backend.md)). The legacy plaintext sibling `settings.json` is the one path `settings-store.ts` still spells itself (`legacyPlaintextPath`, `packages/host/src/settings-store.ts:87-89`). `tenantDataDir` is `localDataDir()` for `local-tenant` and `<localDataDir()>/tenants/<tenantId>` for every other tenant (Phase 3 lane D; [`tenant-storage.md`](tenant-storage.md)), so a desktop install's path is unchanged. File shape `SettingsFileV2` (`packages/host/src/settings-store.ts:186-196`): `{ version: 2, locale?, users?: Record<userId, { locale? }>, workspaces: Record<workspaceId, StoredSecrets> }` — `users` is Phase 4's per-person locale, and the version stayed at 2 on purpose, so an older build reads the file rather than treating it as a v1 blob — settings are **per tenant in the file, per workspace in the map**, which is why `saveSettings` takes a `SettingsScope` (`packages/host/src/settings-store.ts:41`). `StoredSecrets` (`packages/core/src/secrets.ts:7-59`) holds the gateway key `openaiApiKey`, the non-GTM extras `googleApiKey` / `anthropicApiKey` / `volcengineApiKey`, `toolKeys`, tool backends, model defaults and the WeKnora sidecar creds.

Writer `persistEncrypted` (`:177-183`) → `encryptJson(file, getLocalVaultKey())`. Reader `loadEncryptedPayload` (`:230-245`) → `isEnvelope` check then `decryptJson`.

### 8. What `GET /api/v1/settings` may say

`settingsPayload()` (`packages/host/src/handlers/settings.ts:85-122`) spreads `...maskSecrets(settings)` at `:92` and never spreads the raw `StoredSecrets`. `maskSecrets` (`packages/core/src/secrets.ts:251-280`) touches the four key fields in exactly two ways:

- `Boolean(...)` → `hasOpenai` / `hasGoogle` / `hasAnthropic` / `hasVolcengine` (`:227-230`); `hasToolKeys` is the same idea per tool name (`packages/core/src/tools/credentials.ts:374-385`).
- `keyFingerprintOrNull(...)` → `openaiKeyFingerprint` and the three extras (`:239-242`).

`keyFingerprint` (`packages/core/src/security/fingerprint.ts:8-15`): trim, `sha256` hex, return `sha256:` + the **first 12 hex characters** (48 bits). `keyFingerprintOrNull` (`:18-23`) is the null-safe wrapper.

`openaiBaseUrl` is not the stored value either — `maskSecrets` returns `resolvedGatewayBaseUrl()` (`packages/core/src/secrets.ts:264`), and `withGatewayDefault` (`packages/host/src/settings-store.ts:348-355`) discards any persisted base URL on load and save. The endpoint is pinned in code (`packages/core/src/gateway/pinned.ts:8`), which is why `settings-endpoint`, `settings-endpoint-reset` and `openai-base-url` all have count 0 in the UI.

Driven on the owner's keyless desk (2026-09-17, `runtime: stub`): the 222,715-byte response contained `hasOpenai: false`, `openaiKeyFingerprint: null`, and no `openaiKey` / `apiKey` / `sk-` substring anywhere.

### 9. Save, and what the browser shows

`POST /api/v1/settings` → `handlePostSettings` (`packages/host/src/handlers/settings.ts:138-209`) builds a `SecretPatch` (`:148-163`) and calls `saveSettings` (`:164`). `mergeSecrets` (`packages/core/src/secrets.ts:129-154`) decides what a field means:

- field **absent** from the body → `continue`, existing key kept. This is what makes the empty password box safe.
- field present and **empty after trim** → `delete next[field]` (`:110-115`), the key is cleared.

The UI renders `key-fingerprint` at `apps/web/components/settings-page.tsx:401`, gated at `:399` by `hasOpenai && openaiKeyFingerprint` — both, so a fingerprint without a key cannot paint. `openai-key` is the `type="password"` input at `:377` (placeholder swaps on `hasOpenai`, `:374`), `runtime-status` at `:290`, `privacy-note` at `:419`. The fingerprint state is only ever assigned from the response (`:124-128`); a grep of `apps/web` for `sha256` / `createHash` / `keyFingerprint` finds nothing, so the browser never hashes.

Doctor mirrors the same gate: `.cursor/skills/verify-agentforge/scripts/doctor.mjs:210-216` reports `keyFingerprint: true` only when `hasOpenai` and the string starts with `sha256:` and has content past the prefix.

### Failure modes

| Failure | Where | What happens |
|---|---|---|
| Prompt contains an email / formatted phone / SSN-style id / Luhn-valid card | `packages/core/src/security/pii.ts:158-239` | outbound copy gets the token; the stored message keeps the original |
| Prompt contains a NIK, a dotted NPWP, a labelled bank account or an `08xx` phone | `packages/core/src/security/pii-id.ts`, called at `packages/core/src/security/pii.ts:167-169` | same — `[nik]` / `[npwp]` / `[account]` / `[phone]` on the outbound copy only. Not Finance-only: this fires for every `maskPii` caller |
| Prompt contains a bare 13-digit market cap | `:229-230`, `:72` | **not** masked, by design |
| Prompt contains `1.250.000.000.000` (rupiah grouping) or a bare total that happens to pass Luhn | `looksLikeAmount` (`:116-119`), `bareRunLooksLikeCard` (`:151-156`), `slicedFromNumber` (`:131-137`) | **not** masked. These three guards were added on 2026-09-17 after a property test caught the scanner rewriting figures |
| Attachment carries `ignore previous instructions` | `packages/core/src/security/injection-guard.ts:129-138` | that block is replaced with a `[Attachment blocked …]` line; the run continues |
| Same, with `injectionGuardBypass: true` | `packages/host/src/runs.ts:135` | guard skipped entirely, no audit line is written |
| `settings.enc` will not decrypt (wrap key changed / keytar fell back) | `onUndecryptableSettings`, `packages/host/src/settings-store.ts:373-385` | **Desk:** quarantined to `settings.enc.unreadable`; app boots keyless and shows onboarding, unchanged. **Server (Phase 4):** refused with `settings_unreadable` (500) and the payload left untouched — quarantining one tenant's key on a shared box is a loss they cannot undo |
| `settings.enc` is not an envelope | `packages/host/src/settings-store.ts:311` | throws `"settings.enc is not a valid envelope"` → same quarantine |
| A sealed column holds pre-encryption plaintext | `packages/core/src/crypto/envelope.ts:62`, `:65` | returned as-is; no error, no re-seal |
| Client sends `openaiApiKey: ""` | `mergeSecrets`, `packages/core/src/secrets.ts:129-142` | key deleted, so `hasOpenai` (`packages/core/src/secrets.ts:253`) goes false |
| Client omits `openaiApiKey` | `mergeSecrets`, `packages/core/src/secrets.ts:129-142` | key untouched |
| No key saved | `apps/web/components/settings-page.tsx:399` | `key-fingerprint` not rendered; `privacy-note` still visible; doctor `keyFingerprint: false` — **not** a doctor fail |

## Where things live

| File | Role |
|---|---|
| `packages/core/src/security/pii.ts` | `scanPii` / `maskPii` / `maskPiiInParts` / `maskOutboundRunInput`, the four original regexes, the Luhn check, and the three money guards (`looksLikeAmount`, `slicedFromNumber`, `bareRunLooksLikeCard`) |
| `packages/core/src/security/pii-id.ts` | `scanIndonesianIds` — NIK, NPWP, labelled bank account, `08xx` phone; the BPS province table and the money-cue lookback |
| `packages/core/src/finance/pii-scan.ts`, `pii-columns.ts` | `scanFinanceTablePii` and `classifyFinanceHeader` — the column-aware scanner and the `Karyawan N` pseudonyms |
| `packages/host/src/finance-privacy.ts` | `guardFinanceInput`, `restoreFinanceAmounts`, `redactFinanceRows` / `redactFinanceSheets` — the Finance-only guard in front of the prompt |
| `packages/core/src/runtime/create-runtime.ts` | the `withToolSecrets` wrapper where masking actually fires (`:26`) |
| `packages/host/src/runs.ts` | run orchestrator: injection guard (`:135`), persist original (`:247`), execute masked (`:282`) |
| `packages/host/src/threads.ts` | `sealJson` / `openJson`; message and tool-invocation writes |
| `packages/core/src/security/injection-guard.ts` | the five rules, homoglyph folding, attachment redaction |
| `packages/host/src/knowledge-ingest.ts`, `knowledge.ts`, `job-source.ts`, `research-generate.ts` | the other injection-guard call sites |
| `packages/core/src/crypto/envelope.ts` | AES-256-GCM seal/open and the legacy-plaintext escape |
| `packages/db/src/vault-key.ts` | `getLocalVaultKey`, `data/.master-key`, data-dir resolution |
| `apps/desktop/main.cjs` | keytar service/account, `wrapKey()`, the session-only fallback, env injection |
| `packages/host/src/settings-store.ts` | `settings.enc` path, write, read, quarantine, gateway-URL pinning on load |
| `packages/core/src/secrets.ts` | `StoredSecrets`, `mergeSecrets`, `maskSecrets` |
| `packages/core/src/security/fingerprint.ts` | `keyFingerprint` — SHA-256, 12 hex chars |
| `packages/host/src/handlers/settings.ts` | GET / POST handlers and `settingsPayload` |
| `apps/web/components/settings-page.tsx` | `openai-key`, `key-fingerprint`, `privacy-note`, `runtime-status` |
| `.cursor/skills/verify-agentforge/scripts/doctor.mjs` | `keyFingerprint` boolean (`:210-216`) |

## Gotchas

- **No host job calls `maskPii`, and every host job is still masked.** Grep `packages/host` for `maskPii` and you find studio prompts (`packages/host/src/studio-generate.ts:279`, `:224`), edit retries (`packages/host/src/edit/generate.ts:38`), search queries (`packages/host/src/research-generate.ts:147`, `packages/host/src/market/tools.ts:88`) and knowledge cards (`packages/host/src/knowledge-ingest.ts:40`, `:42`) — and none of Chat, Finance, Data, Documents, Presentations, Market or Legal. That absence used to read as "host jobs are not masked". It is the opposite: **every** job goes through `collectJobAssistantText` (`packages/host/src/job-regen.ts:89-90`), which builds the runtime with `createRuntime(settings)` and therefore lands on the same wrapper Chat does (`packages/core/src/runtime/create-runtime.ts:26`). Finance reaches it from `finance-generate.ts` and `finance-tasks/runner.ts`. The mask is a property of the runtime, not of any one call site — which is why nobody has to remember to call it.
- **Finance has a second, earlier guard.** The wrapper above masks the outbound copy of the run; `packages/host/src/finance-privacy.ts` redacts the input before the prompt is built, with column context the shared scanner cannot have. See "Finance privacy guard" at the end of this page.
- **`piiWarning()` is dead code.** It exists (`packages/core/src/security/pii.ts:299-314`), is exported (`packages/core/src/index.ts:162`) and is tested (`packages/core/src/security/pii.test.ts:197-211`), but no product code calls it. It is the leftover of the removed banner; `pii-warning` and `pii-send-anyway` are 0 everywhere in `apps/` and `packages/`.
- **The market-tool query masks and then un-masks.** `searchQueryFor` (`packages/host/src/market/tools.ts:87-89`) runs `maskPii` and then strips the `[email]`-style tokens back out with `PII_MASK_TOKEN` (`:57`), because an FTS query containing a literal `[email]` matches nothing. The net effect is deletion, not substitution. That regex now lists **all eight** tokens — `email|phone|id|card|nik|npwp|account|name` — so the four kinds added on 2026-09-17 are stripped like the rest.
- **A bypass leaves no trace.** Nothing logs when `injectionGuardBypass` skips a scan, on any of the eight call sites. Already recorded as a finding in [`knowledge-ingest-loop.md`](knowledge-ingest-loop.md) for the knowledge path; it is true of the Chat path (`packages/host/src/runs.ts:135`) too.
- **The envelope key is a bare SHA-256, not a KDF.** `wrappingKeyFromSecret` (`packages/core/src/crypto/envelope.ts:14-16`) is correct here only because both inputs are already 32 random bytes (`apps/desktop/main.cjs:290`, `packages/db/src/vault-key.ts:111`). Anyone who lets a human-chosen `AGENTFORGE_SECRETS_KEY` into that path has turned it into an unsalted password hash.
- **`openPayload` cannot tell "legacy plaintext" from "someone replaced the envelope with plaintext".** `packages/core/src/crypto/envelope.ts:62`/`:65` return the value whenever it does not look like an envelope. The GCM tag protects a sealed row; it protects nothing about a row that was never sealed.
- **Thread titles are plaintext and derived from the first user message.** `packages/host/src/threads.ts:201`, `:228` open the sealed content and write a title with `.set({ title })` at `:252-255`, unsealed. A message body that is sealed at rest can still surface, truncated, in a plaintext `threads.title` column.
- **The fingerprint is 48 bits.** `sha256:` plus 12 hex characters (`packages/core/src/security/fingerprint.ts:13-14`). It identifies which key is saved; it is not a proof of possession and must never be pasted into `openai-key`.
- **Extras have fingerprints but no GTM UI.** `googleKeyFingerprint` / `anthropicKeyFingerprint` / `volcengineKeyFingerprint` are always in the response (`packages/core/src/secrets.ts:259-261`) even though Settings shows only `hasGoogle` / `hasAnthropic` / `hasVolcengine`. Do not read a non-null extras fingerprint as a UI regression.
- **`AGENTFORGE_PACKAGED` is never set.** `isPackagedRuntime()` (`packages/core/src/gateway/pinned.ts:25-27`) reads it, `gatewayUrlOverrideAllowed()` (`:34-36`) depends on it, and the comment at `:24` says "`main.cjs` sets this before `host.cjs` loads" — but a repo-wide grep finds it only in `pinned.ts` and `pinned.test.ts`. `apps/desktop/main.cjs:79-81` sets `AGENTFORGE_PRODUCT_NAME` / `_GATEWAY_NAME` / `_GATEWAY_URL` and nothing else. So in a packaged build the "dev/test hook" is live — which is exactly how Kemenkeu AI and AIHub Metranet get their `https://aihub.metranet.co.id/v1` lock, and also why the pin is not actually enforced there. See `findings.md` for this run.
- **Settings are per tenant, then per workspace.** One `settings.enc` per tenant, and inside it `{ workspaces: { <id>: StoredSecrets } }` (`packages/host/src/settings-store.ts:186-196`). A key saved on one desk is not a key on another, and `clearGatewayKeyEverywhere(scope)` (`:420-436`) exists precisely because the per-workspace shape makes "remove my key" a multi-row operation — it clears every desk of **one tenant**, not of the install.
- **`apps/desktop/host.cjs` is a build artifact** (gitignored, `.gitignore:35`) and is regenerated while a dev build watches. Never cite `file:line` in it; the tracked source is `apps/desktop/main.cjs`.

## Verify

`.cursor/skills/verify-agentforge/features/pii.md` — sub-features `pii-keep-original`, `pii-mask-outbound`, `pii-local-scan`, `pii-no-banner`.
`.cursor/skills/verify-agentforge/features/security.md` — sub-features `key-fingerprint`, `privacy-note`, and the doctor `keyFingerprint` boolean.

DOM testids that prove it: `composer-text` / `composer-send` / `message-list` / `message-output` for the keep-original half (see [`chat-send.md`](chat-send.md) for their lines); `settings-form`, `openai-key` (`apps/web/components/settings-page.tsx:377`), `key-fingerprint` (`:400`), `privacy-note` (`:419`), `runtime-status` (`:290`). The Finance guard's own two handles are `finance-upload-pii` (`apps/web/components/finance-file-upload.tsx:101`) and `finance-result-pii` (`apps/web/components/finance-steps/finance-result-notices.tsx:21`) — both are plain notices carrying `pii.count`, with no confirm, dismiss or "send anyway" control anywhere. `pii-warning` and `pii-send-anyway` must both be count 0. `settings-endpoint`, `settings-endpoint-reset` and `openai-base-url` must all be count 0 — the endpoint is pinned.

Non-DOM checks: `doctor.mjs` `keyFingerprint` must be `false` on a keyless desk and must not exit 1; `GET /api/v1/settings` must contain no raw key. Unit coverage: `packages/core/src/security/pii.test.ts` (the `hello @ world` no-match at `:36`, the market-cap non-match at `:39-46`, the outbound-input mask at `:75-85`), `packages/core/src/finance/pii-scan.test.ts` (the 200-amount property table that found the two money bugs), `packages/host/src/finance-privacy.test.ts` and `packages/host/src/finance-egress.test.ts` (the static import walk and the dynamic no-socket assertion), `packages/core/src/crypto/envelope.test.ts:107-125` (round trip + legacy plaintext), `packages/core/src/gateway/pinned.test.ts:56-81`.

## Why

**Why bare digit runs are excluded from `phone` and `id`.** `[Direct]` the code comments say it twice — `packages/core/src/security/pii.ts:72` ("Bare digit runs are quantities (market cap, volume), not phones. Require + / 00 or separators.") and `:229-230` (the same sentence for IDs). `[Direct]` `packages/core/src/market/briefing-prompt.test.ts:172-183` is a named regression test asserting a market-cap figure survives `maskPii` inside real briefing text. `[Supported]` the Finance and Market job prompts are built from exactly such figures, so a false `[id]` would corrupt the numbers the model is asked to reason over. **Confidence: high.**

**Why the injection guard has no "this looks benign" carve-out.** `[Direct]` `packages/core/src/security/injection-guard.ts:72-76` states it in the source: a heuristic exemption would itself be the jailbreak, so the only way past the guard is the explicit `injectionGuardBypass` setting. **Confidence: high.**

**Why the fingerprint is a prefix rather than the whole digest.** `[Supported]` `.cursor/skills/verify-agentforge/features/security.md` describes it as a way to "confirm which gateway key is saved without ever showing the raw secret", and the implementation truncates to 12 hex (`packages/core/src/security/fingerprint.ts:13-14`). `[Inferred]` a full digest of a key drawn from a small keyspace would be closer to an offline-checkable commitment to the key itself; 48 bits is enough to tell two of the owner's keys apart and short enough to read at a glance. The inference chain is: the stated purpose is identification, not proof; truncation reduces what an exfiltrated payload is worth; no source states the bit count was chosen for that reason. **Confidence: medium.**

**Why the gateway base URL is returned from `resolvedGatewayBaseUrl()` instead of storage.** `[Direct]` `packages/core/src/gateway/pinned.ts:1-3` — "Pinned: the owner cannot change it from Settings, and a stored `openaiBaseUrl` from an older build is tolerated on read but never honoured." `[Direct]` `packages/host/src/settings-store.ts:348-355` (`withGatewayDefault`) implements the discard. `[Supported]` SKILL.md requires `settings-endpoint` / `settings-endpoint-reset` / `openai-base-url` to have count 0 since 2026-09-17, which is the UI half of the same decision. **Confidence: high.**


## Finance privacy guard (added 2026-09-17)

Everything above describes the mask that rides the **outbound copy** of a run. Finance needed a second,
earlier guard, for a reason the rest of the product does not have: a Finance prompt is the owner's own
payroll and ledger rows, and the shared scanner is deliberately blind to most of what is in them.

### The problem the shared scanner could not solve

`scanPii` has to be safe for Market and Finance, so it refuses every detector it cannot justify without
context — which is why §1 says bare digit runs are quantities. That rule is right, and it also means a
payroll sheet's NIK column, NPWP column, bank account column and name column all went to the model
untouched. They are the columns that identify a person; the amounts beside them are the only thing the
brief is actually about.

### Two new files in core

`packages/core/src/security/pii-id.ts` — Indonesian identifiers for the shared scanner. `scanIndonesianIds`
runs first inside `scanPii`, so a NIK that happens to pass Luhn comes back as `[nik]` and not `[card]`.
Every detector has to prove itself against money:

| Kind | What makes it safe |
|---|---|
| `nik` | 16 digits with a valid BPS province code (the 38 real ones, plus `99` reserved for fixtures), a non-zero regency and district, a real calendar birth date (`+40` on the day marks a woman), and a serial in 0001–9999. An **unlabelled** run must also not end in a round thousand, and must not follow a money cue (`Total:`, `Rp`, `Jumlah`) within 24 characters. |
| `npwp` | the dotted `NN.NNN.NNN.N-NNN.NNN` shape, which no amount is ever written in — or 15/16 digits when the text says `NPWP` right before them. |
| `account` | only when a strong cue (`No. Rekening`, `norek`, `a/c`, `acct`, `account no`) sits **immediately** before the digits. "Rekening Bank: 1250000000" and "Accounts payable 450000000" therefore do not match: a word in between means the number is an amount. |
| `phone` | `08xx` local forms. The leading `0` is the whole argument — no amount starts with one — and a lookbehind stops `1.081.250.000` from donating an `081`. `+62` was already covered by the intl pattern. |

New tokens: `[nik]` `[npwp]` `[account]` `[name]`. `name` is never produced by the global scanner; it only
comes from the table scanner below.

`packages/core/src/finance/pii-scan.ts` (with `pii-columns.ts`) — the column-aware scanner.
`scanFinanceTablePii` takes sheet rows, figures text or confirmed line items and answers
`{ hits, redacted }`. Headers decide: a column titled `Nama`/`NIK`/`No. Rekening`/`No. HP`/`Email` is
redacted wholesale, names becoming stable pseudonyms (`Karyawan 1`, `Karyawan 2`) so per-person rows stay
distinguishable and every total still adds up. Three rules hold everywhere in that file: an amount header
outranks every other rule, a cell that reads as a number is never swapped for a name, and a reported
`preview` is the redacted text rather than the original.

There is no free-text name detection anywhere. A guesser would have to decide whether "Pendapatan Budi" is
a person or a revenue line, and a wrong guess costs the brief a number.

### Two money bugs the property test found

A table of 200 realistic amounts (`packages/core/src/finance/pii-scan.test.ts`) turned up two
**pre-existing** false positives in `scanPii`, both of which silently rewrote a figure:

- `1.250.000.000.000` came back as `[phone]`. The intl pattern accepts `.` as a separator, so any
  12-digit rupiah total written the Indonesian way matched. Fixed by `looksLikeAmount`
  (`packages/core/src/security/pii.ts:116-119`) over `GROUPED_THOUSANDS_RE` (`:89`) and `ROUND_TOTAL_RE`
  (`:82`): uniform three-digit groups are money, and phones group 3-4.
- A bare 14–19 digit total that happened to pass Luhn came back as `[card]` — roughly one bare run in
  ten. Fixed by `bareRunLooksLikeCard` (`:151-156`): an **unseparated** run now also has to open with a
  real issuer prefix (`CARD_PREFIX_RE`, `:145`) and must not end in four zeros (`CARD_ROUND_TAIL_RE`,
  `:148`). A card a person wrote out (`4111 1111 1111 1111`) keeps the old path untouched.

A third guard landed with them: `slicedFromNumber` (`packages/core/src/security/pii.ts:131-137`) refuses a
match that was cut out of the middle of a longer number, which is what a PDF does when it flattens a table
and two amounts end up side by side on one line.

And a backstop behind all three, in the host: `restoreFinanceAmounts` (`packages/host/src/finance-privacy.ts:92-110`)
re-reads every non-identifier cell after redaction and, if a cell that parsed as a number no longer parses to
the same number, puts the original back. The owner is told only the count, through the
`pii_amount_restored` import warning (`:113-124`), and a hit that was restored is filtered out of the `pii`
summary (`wasRestored`, `:127-129`) so a figure that survived is never reported as hidden. The file's header
states the rule it enforces (`:16-17`): **redaction may hide an identifier, never a figure.**

### The host guard

`packages/host/src/finance-privacy.ts` — `guardFinanceInput()` redacts one Finance input and returns a
`pii` summary alongside it. It is wired into every route that can put a figure in front of the model:

| Route | What is redacted | What the response carries |
|---|---|---|
| `POST /api/v1/finance/import` | the sheet rows, then `tableToFiguresText` is written **from the redacted rows**; the prose half and every preview row too | `figuresText`, `proseText`, `sheets[].preview`, plus `pii` |
| `POST /api/v1/finance/parse` | the pasted figures, before `expandMagnitudes` | `items`, `needsConfirmation`, `pii` |
| `POST /api/v1/finance`, `/stream` | the confirmed line-item labels and periods, plus the source text `readSourceText` returns | `brief`, `items`, `guard`, `pii` |
| `POST /api/v1/finance/regenerate` | the same line items | `brief`, `items`, `guard`, `pii` |

`pii` is `{ count: number; kinds: PiiKind[]; samples: string[] }` and the samples are the redacted
previews, so the summary can be rendered without ever holding the original.

Redaction is on with no way off. `injectionGuardBypass` turns off the injection guard and nothing else,
and no workspace switch for this exists — `guardFinanceInput` reads no settings at all.

### Why the figures text is built from redacted rows rather than scrubbed afterwards

A narrow sheet becomes `label: value` lines, and the label side of a payroll row is a person's name with
no header attached to it any more. Redacting the rows first means the name is already `Karyawan 1` by the
time the line is written. It has a second effect worth knowing: before redaction the NIK, account and
phone columns all parsed as "numeric", so `narrowColumns` had four candidates for the value column;
afterwards only the salary columns do, and the import picks the right one.

### Egress

`packages/host/src/finance-egress.test.ts` holds both halves of the guarantee.

- **Static.** It walks the import graph out of the Finance handlers (`handlers/finance*.ts`,
  `finance-generate.ts`, `finance-brief-build.ts`, `finance-privacy.ts`, `finance-tasks/**`,
  `renderers/**`, `file-extract/**`) and fails on `fetch(`, `http`/`https`/`net` request calls, a
  `node:net` / `node:http` import, `WebSocket`, `XMLHttpRequest`, a non-empty `toolKeys`, a web-search or
  web-fetch reference, or anything under `packages/host/src/market/`. Two allowlist entries, each with
  its reason in the file: `src/job-regen.ts` (builds the runtime — the pinned gateway is the one
  legitimate egress) and `src/knowledge-embed.ts` (work-card auto-ingest embeds the saved brief at the
  same pinned `/embeddings`, with the base URL from `resolveProviderKeys`, never from a stored setting).
  The walk treats the bare `@agentforge/core` barrel as external, because that barrel is the shared
  runtime surface every studio uses and is exactly what the two allowlisted modules reach it for.
- **Dynamic.** It runs parse and regenerate with `fetch`, `http.request`, `https.request` and
  `net.connect` replaced by spies that record and throw, asserts nothing was attempted, and reads the
  exact prompt handed to the runtime to assert none of a synthetic payroll fixture's names, NIKs, phones
  or emails is in it. The work card written by the auto-ingest is checked the same way.

Hosted document conversion is guarded separately and repository-wide by
`packages/host/src/file-extract/no-hosted-ocr.test.ts`; the egress test does not restate it.

### What this slice does not cover

- ~~The four non-brief tasks do not get the column-aware pseudonymisation.~~ **Closed later the same day.**
  `guardFinanceInput` is now wired into `packages/host/src/finance-tasks/runner.ts:214` and into all four
  parsers — `parse-cashflow.ts:210`, `:226`, `:260`; `parse-budget.ts:153`, `:162`, `:176`;
  `parse-appraisal.ts:99`, `:103`, `:110`, `:114`; `parse-ratios.ts:200`, `:209` — and
  `finance-tasks/budget-embed.ts:7` names it as the caller's contract. `cashflow`, `budget`, `appraisal`
  and `ratios` get the same redaction the brief routes get.
- A name written into free text with no column header above it is not detected, on purpose (see above).
- An unlabelled 16-digit run with no money cue near it passes the NIK structure test about 2.5% of the
  time by chance. A 16-digit total ending in three or more zeros — which is how a rupiah total is almost
  always written — can never pass, because its serial field would be a round thousand.
- ~~`PII_MASK_TOKEN` in `packages/host/src/market/tools.ts` still lists only `email|phone|id|card`.~~
  **Closed.** It is now `/\[(?:email|phone|id|card|nik|npwp|account|name)\]/g` (`market/tools.ts:57`), so a
  Market FTS query no longer carries a literal `[nik]`.
