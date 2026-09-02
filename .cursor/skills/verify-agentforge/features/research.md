# Research

Research is a job: question → sourced notes → Markdown. It is not a citation manager. Live generate needs a gateway key (and search still needs Tavily/Brave). Starters/empty shell are the stub proof.

## Sub-features

- `research-rail` reaches `/research` from `mode-research` on Home (and any workspace that includes Research).
- `research-shell` shows `research-studio` with empty copy.
- `research-studio-model` is the generate-bar chat-catalog dropdown.
- Live generate POSTs `/api/v1/research`. Stub/no-key shows an error with a Settings hint.

## How to get to it (user POV)

- Choose Research on the left rail (`mode-research`). Home already has the tab.
- Open `http://127.0.0.1:3000/research` when the tab is unlocked.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- `mode-research` is visible on Home. If count is 0, you are on a desk that hid Research — switch to Home or add the tab in Workspaces.
- Stub proof stops at the studio shell. Live generate only if the operator asked and doctor reports `ai`.

- **Open Research.** Click `mode-research`. URL matches `/research`. `research-studio` and `research-studio-model` are visible.
- **Cloud.** `foundation.spec.ts` covers the Home rail tab. Do not paste a gateway key.

## Gotchas

- Default Home unlocks Research. A Legal desk also has it. Do not open Studio to unlock the tab.
- Search backends are not the gateway key. Needs-key / 503 without Tavily or Brave is expected on Cloud.
- Do not POST `/api/v1/research` as a substitute for the prompt bar on a live proof.
