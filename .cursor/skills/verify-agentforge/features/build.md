# Build

Build creates a custom agent from a template (or blank), then opens Studio at a UUID. Chat stays the default assistant; templates only seed specialists. Sharing with the workspace is a visibility change, not a multiplayer login.

## Sub-features

- `build-open` opens `/studio/new` with templates and an enabled Create control.
- `build-templates` shows Blank, Default, Students, Marketing, Legal. Campus tool `course_catalog.search` stays absent.
- `build-create` lands on `/studio/<uuid>` with `studio-agent-name` `Assistant` for the Default path.
- `build-share` sets visibility to workspace.
- `build-chat` opens `/agents/<uuid>` and can send through the same composer.
- `build-generate-defaults` shows `agent-image-model` / `agent-video-model` when Images / Videos surfaces are on.

## How to get to it (user POV)

- Choose Agents (`mode-agents`) then Build (`new-agent-link`).
- Choose `settings-build-link` ("Build an agent") when the Agents tab is off.
- Open `http://127.0.0.1:3000/studio/new`.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- On the operator's Windows desk, creating an agent unlocks Images/Videos/Presentation for everyone on this SQLite file. Say so before you click Create. Prefer Cloud Playwright for a throwaway Assistant.
- Default name field is `Assistant`.

- **Open Agents.** Click `mode-agents`. Click `new-agent-link`. URL is `/studio/new` (30s).
- **Templates.** `create-agent` is enabled (30s). `template-blank`, `template-default`, `template-students`, `template-marketing`, `template-legal` are visible. `tool-course_catalog.search` has count 0. `agent-name` value is `Assistant`.
- **Create.** Click `create-agent`. Wait for URL `/studio/[0-9a-f-]{36}` (60s). Do not treat `/studio/new` as success. `studio-agent-name` reads `Assistant` (30s).
- **Rail unlock.** After a Default (or legacy-five) agent exists, `mode-images`, `mode-videos`, and `mode-presentations` become visible. `mode-documents` and `mode-research` stay count 0 unless that template unlocked them.
- **Generate defaults.** On `/studio/<uuid>` with Images on, `agent-image-model` is visible. Save with `save-generate-defaults`.
- **Share.** Click `share-workspace`. `visibility` contains `workspace` (15s).
- **Agent chat.** Click the link named `Open chat`. URL is `/agents/<uuid>`. `composer` is visible. `model-picker` is not the bare word `Model` (15s). Send a unique prompt; `message-list` contains it (30s); `composer-send` returns to `Send`.
- **IDE proof.** Screenshot of Studio with the UUID in the URL and `studio-agent-name`. Cloud owns the create+share smoke.

## Gotchas

- Playwright and `/studio/**` also match `/studio/new`. Always wait for a 36-char UUID.
- Blank template unlocks only Chat unless the user adds surfaces. Default unlocks the original five (`chat`, `agents`, `images`, `videos`, `presentations`).
- Kernel forbids `student` / `course` nouns. Seeing `tool-course_catalog.search` on `/studio/new` is a product bug.
- Do not create a second agent on the operator's desk to "fix" a missing Images tab without asking.
- Agent chat is `/agents/<id>`, not `/chat/<id>` (`/chat/[agentId]` redirects).
