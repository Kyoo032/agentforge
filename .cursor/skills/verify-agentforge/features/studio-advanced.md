# Studio advanced

After Create, Studio at `/studio/[agentId]` edits the agent's soul (system prompt), tools, and model. Save publishes a **new** agent version — it must not mutate the already-published version in place. Build covers creation; this file covers post-create editing.

## Sub-features

- `agent-prompt` is the soul / system-prompt editor on `/studio/<uuid>` (hidden for the default chat agent).
- `studio-model-picker` is the studio model select for the agent's default chat model.
- `tool-*` chips toggle tool bindings (testid prefix `tool-` plus the tool key from `GET /api/v1/tools`).
- `save-soul` posts `POST /api/v1/agents/{id}/soul` and publishes the new version. The page shows `Published vN`.

## How to get to it (user POV)

- Choose Agents → Build, create or open an agent, land on `/studio/<uuid>`.
- The Soul fieldset sits above Product surfaces. It does not render for the default Chat agent (`isDefaultChat`).
- Edit the instructions, model, or tool chips. Save publishes a new version.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- Prefer Cloud / throwaway SQLite for create+edit. On the operator's Windows desk, say so before mutating an agent.
- `build.md` covers Create through `/studio/<uuid>`. This drive starts with an existing published studio UUID (create + the first publish from Build if needed).

- **Open studio.** Navigate to `/studio/<uuid>` (36-char UUID). Wait until the URL is not `/studio/new`. `studio-agent-name` is visible. Wait until `agent-prompt` is visible — the Soul block hydrates from `GET /api/v1/agents/{id}` and is absent until that payload lands (and is omitted entirely for default chat).
- **Soul.** Change `agent-prompt` to a unique string (e.g. `VERIFY soul <run-id>`).
- **Tools / model.** Toggle a visible `tool-*` chip if tools have loaded. `studio-model-picker` is present when `GET /api/v1/models` has returned.
- **Save.** Click `save-soul`. Expect on-page text `Published v2` (or the next integer). Reloading studio still shows the new soul text. The previous version row stays unchanged (`GET` versions: v1 prompt is the original, v2 is the edit, `currentVersionId` points at v2).
- **IDE proof.** Screenshot under `evidence/studio-advanced/<run-id>/` with the UUID in the URL and the edited soul visible after save.
- **Cloud.** Build creation stays in `foundation.spec.ts`. Add soul asserts only when this drive is in scope — do not block the serial foundation pass on extra soul clicks unless that spec is updated.

## Gotchas

- Playwright `/studio/**` also matches `/studio/new`. Always wait for `/studio/<uuid>` (36-char id).
- Soul fields prefill from the **published** version. Wait for `agent-prompt` visible; a fixed sleep after navigation is not enough if the GET is slow.
- `save-soul` is disabled until a published version exists and a model is selected. Create-then-immediately-edit on a still-draft agent will no-op — publish first (Build create already publishes the default template).
- In-place mutation of the published version is a bug. Save must insert version N+1 and point `currentVersionId` at it.
- Default chat (`quick-chat`) has no Soul fieldset. Do not fail the drive for missing `agent-prompt` on that agent.
- Kernel forbids `student` / `course` nouns on tool chips in core templates. Campus tools stay in the university pack.
