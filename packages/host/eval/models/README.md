# Model policy tools (dev only, never ships)

Two tools for keeping `MODEL_POLICY_TABLE` (`packages/core/src/models/model-policy.ts`) honest against
the live gateway. Map: [`docs/internal/maps/model-policy.md`](../../../../docs/internal/maps/model-policy.md).

- **`catalog-diff`** reads the desk's model list and says, for every chat id, which policy entry knows
  it or that it is `UNKNOWN`; how each ranked list the product uses fares against the live catalogue
  (`LIVE` / `MISSING` / `UNKNOWN`); what each model costs; and which ids are new or gone since the last run.
- **`probe`** sends one tiny real request per Thinking level to models the table does not know, raw,
  and writes what the gateway did, plus a proposed table entry per model **for a human to review**. It never
  edits `model-policy.ts`.

Nothing here is imported by the app, the desktop build or the hosted image. It lives beside
`eval/finance`, outside `packages/host/src`, and `packages/host/tsconfig.json` and the host's vitest config
only look at `src`. `results/` is gitignored.

## Run it

Both tools run in-process against a desk, named by `AGENTFORGE_DATA_DIR`, and read the desk's saved
gateway key through the host's own settings loading (`packages/host/src/settings-store.ts`,
`loadSettings`). They never start or call the running :3000 server.

```bash
# Windows shell: set the variable first (PowerShell: $env:AGENTFORGE_DATA_DIR = "..."), then
#   AGENTFORGE_DATA_DIR=C:\Users\rizky\agentforge\.webdev-data-design

pnpm --filter @agentforge/host eval:models:diff                 # saved cache, prices, snapshot, diff
pnpm --filter @agentforge/host eval:models:diff --refresh       # ask the gateway for its list now
pnpm --filter @agentforge/host eval:models:probe --dry-run      # the plan and the call count, no calls
pnpm --filter @agentforge/host eval:models:probe                # probe every UNKNOWN live chat id
pnpm --filter @agentforge/host eval:models:probe --ids gpt-6-luna --only-ids --extra
pnpm --filter @agentforge/host eval:models:test                 # the unit tests (no network)
```

The scripts run `tsx` (hoisted at the repo root, as `pnpm dev` uses it). Direct form, from
`packages/host`: `npx tsx eval/models/probe.ts --dry-run`.

### `catalog-diff` flags

| flag | meaning |
| --- | --- |
| `--refresh` | `GET <endpoint>/models` now, with the desk's saved key (the call the host's own refresh makes). The answer goes into the report only: the desk's `models-cache.json` is never written. Needs a saved key and refuses the stub runtime. |
| `--no-prices` | skip the gateway's public price list |
| `--no-save` | do not write this run's snapshot |
| `--json` | print the report as JSON |
| `--out <dir>` | results folder (default `eval/models/results`) |
| `--workspace <id>` | which desk's key `--refresh` uses (default: the selected desk) |

Without `--refresh` it reads the saved cache and calls nothing but the price list.

**Prices.** The gateway serves a public, keyless price list at `GET <origin>/api/pricing`, which the app
already reads for its usage panel (`fetchPricingCatalog`, `packages/core/src/gateway/account.ts:379`;
called from `packages/host/src/account-usage.ts:154`). The report prints dollars per million input and
output tokens through the same estimator the app uses (`explainRunUsd`), at group ratio 1; a key in a
cheaper group pays less. A per-call model prints per call; tiered billing prints "no flat price". The
`/v1/models` list itself carries no price. If the price list cannot be read the report prints without
prices and says why.

### `probe` flags

| flag | meaning |
| --- | --- |
| `--ids a,b` | also probe these ids (default set: every live chat id the table does not know; embedding, image and rerank ids are never in it) |
| `--only-ids` | probe only `--ids` |
| `--extra` | add Extra and Max to Off, Light, Normal and Deep |
| `--levels a,b` | replace the level set (`none,minimal,low,medium,high,xhigh,max,ultra`) |
| `--wire <wire>` | send every model on this wire instead of the policy's (`chat_completions`, `responses`, `anthropic_messages`, `google_generate_content`) |
| `--max-calls <n>` | hard budget of requests, retries included (default 60, ceiling 1000) |
| `--delay-ms <n>` | pause between requests (default 750) |
| `--timeout-ms <n>` | per-request timeout (default 60000) |
| `--max-tokens <n>` | output tokens per request (default 32) |
| `--dry-run` | print the plan and stop |
| `--out <dir>`, `--workspace <id>` | as above |

**What one model costs.** A baseline call with no effort parameter first (so a refused level can be told
from a model that is simply unreachable; if the baseline fails the model's levels are skipped), then one
call per level, sequential, with a pause. A nominal run is `1 + levels` calls per model (5 by default, 7
with `--extra`); a refused output budget can add at most two retries per model. `--max-calls` stops
the whole run, retries included, and the summary says which models and levels it did not reach.

**Raw.** Nothing goes through `AiSdkRuntime`, so the self-heal (`effort-selfheal.ts`) is not involved
and the policy table does not snap or drop a level: the level goes on the wire exactly as asked, in the body
the runtime itself writes for that wire (`applyReasoningEffortToChatBody`, `applyReasoningToResponsesBody`,
`applyAnthropicMessagesBody`, `applyGeminiGenerateContentBody`). Chat and Responses stream, so time to first
token is real.

**Output budget.** 32 tokens by default. A reasoning model may refuse that: a floor ("Expected a value
>= 16") raises the budget once to the number the gateway names (capped at 1024), and a model that wants
`max_completion_tokens` instead of `max_tokens` is switched once. Both are remembered for that model and
each retry counts against the budget.

## What it writes

`results/catalog-<timestamp>.json`: the snapshot the next `catalog-diff` diffs against, with the whole
report under `report`.

`results/probe-<timestamp>.json`: the trace. Per model: its wire, its policy entry, every call
(`status`, the gateway's `errorCode` and `errorMessage` truncated to 300 characters, `failureKind`,
`effortRefusal` when the core classifier reads the refusal as about the Thinking level, `ttftMs`, `totalMs`,
`usage` with reasoning tokens when the gateway returned them, `answered`, `sends`, the effort field as it was
written), a `summary` (levels accepted, refused, no verdict, per-level timing and tokens, and where the table
and the gateway disagree) and a `proposal`.

`results/probe-<timestamp>.snippets.txt`: the proposed `MODEL_POLICY_TABLE` entries, one per model, ready to
read and paste by hand. Each says what was not tried or gave no verdict; `Off` is proposed as `send_none` when
it was accepted, `floor` or `omit` when it was refused.

## What it never does

- It never edits `model-policy.ts`, `model-policy-golden.json` or any source file. A proposal is text.
- It never prints, logs or writes the gateway key or its fingerprint. The key lives in `GatewayCredentials`
  (`credentials.ts`), a private field that does not serialise, does not print through `util.inspect` or a
  template string, and is scrubbed out of any message the gateway echoes back (`[key]`). No record holds
  a request body, a prompt or a header.
- It refuses to run with `AGENTFORGE_RUNTIME=stub`, with no `AGENTFORGE_DATA_DIR`, or with no saved key on
  the desk (an `OPENAI_API_KEY` in the shell is not used). A dry run and a read of the saved cache need only the
  desk.
- It sends the key only to the pinned gateway endpoint (`resolvedGatewayBaseUrl()`, https or loopback,
  `assertAllowedEndpointUrl`). `AGENTFORGE_GATEWAY_URL` re-points it exactly as it does for the app, and only
  outside a packaged or production build.
- It never writes the desk. Reading settings does not modify them; `--refresh` does not touch `models-cache.json`.

## Layout

| file | role |
| --- | --- |
| `catalog-diff.ts`, `probe.ts` | entry points: wire the host's own modules in, print, set the exit code (2 for a refusal or a bad command line) |
| `run-catalog-diff.ts`, `run-probe.ts` | the commands, with every dependency passed in |
| `catalog-report.ts`, `lists.ts`, `snapshots.ts`, `pricing.ts` | the report, the ranked lists, snapshot files, prices |
| `probe-request.ts`, `probe-call.ts`, `probe-frames.ts`, `probe-errors.ts` | one request per wire, one call with timing and usage, the streamed frames, the error reading |
| `probe-run.ts`, `snippet.ts` | the sequence, the budget, the summary and the proposed entry |
| `credentials.ts`, `args.ts` | refusals and the key; the command line |
| `*.test.ts`, `vitest.config.ts`, `test-setup.ts` | unit tests; `fetch` is a fake, and a real one throws |
