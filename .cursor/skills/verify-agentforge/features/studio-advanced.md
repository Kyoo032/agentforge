# Studio advanced

After Create, Studio at `/studio/[agentId]` edits the agent's soul (system prompt), tools, and model. Save publishes a **new** agent version — it must not mutate the already-published version in place. Build covers creation; this file covers post-create editing. Phase 2A lands the edit-specific testids.

## Sub-features

- `agent-prompt` is the soul / system-prompt editor on `/studio/<uuid>`.
- `save-soul` publishes a new agent version from the current editor state.
- `tool-*` chips toggle tool bindings (testid prefix `tool-` plus the tool id).
- `studio-model-picker` is the studio `model-picker` for the agent's default chat model.

## How to get to it (user POV)

- Choose Agents → Build, create or open an agent, land on `/studio/<uuid>`.
- Edit the soul text, tools, or model.
- Save to publish a new version.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- Prefer Cloud / throwaway SQLite for create+edit. On the operator's Windows desk, say so before mutating an agent.
- `build.md` covers Create through `/studio/<uuid>`. This drive starts with an existing studio UUID (create first via Build if needed).
- Phase 2A must have landed edit-specific handles used below (`save-soul` and any new tool/model asserts). Until those are present, mark the edit steps **skip with unmet precondition**. Creation remains covered by `build.md`.

Contract when Phase 2A edit handles are present:

- **Open studio.** Navigate to `/studio/<uuid>` (36-char UUID). Wait until the URL is not `/studio/new`. `studio-agent-name` is visible.
- **Soul.** `agent-prompt` is visible. Change the text to a unique string (e.g. `VERIFY soul <run-id>`).
- **Tools / model.** Toggle a visible `tool-*` chip if the template exposes one. `model-picker` is present in studio chrome when models have loaded.
- **Save.** Click `save-soul`. A new version is published (version indicator advances or a success state appears). Reloading studio still shows the new soul text — not a silent in-place rewrite of the prior published version's identity.
- **IDE proof.** Screenshot under `evidence/studio-advanced/<run-id>/` with the UUID in the URL and the edited soul visible after save.
- **Cloud.** Build creation stays in `foundation.spec.ts`; add edit asserts only after Phase 2A testids ship.

## Gotchas

- Playwright `/studio/**` also matches `/studio/new`. Always wait for `/studio/<uuid>` (36-char id).
- In-place mutation of the published version is a bug, not a shortcut. Save must create a new version.
- Do not treat missing Phase 2A edit testids as a product fail today — skip those steps and keep Build creation green.
- Kernel forbids `student` / `course` nouns on tool chips in core templates. Campus tools stay in the university pack.
