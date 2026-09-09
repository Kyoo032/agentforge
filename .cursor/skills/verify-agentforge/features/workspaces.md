# Workspaces

Workspaces is the owner's local desk switcher: dropdown under the brand on the rail, a list of desks on disk, and create/edit from a template or mode checkboxes. The left-rail Workspaces control must be reachable from both collapsed and expanded rail states via `workspaces-link`. `workspaces-switcher` lists desks and opens one. Each desk keeps its own gateway key, Settings, and Knowledge Base. Creating no longer seeds a starter agent. Open/Create navigates to Chat.

## Sub-features

- `workspaces-open` reaches `/workspaces` via `workspaces-link` from both collapsed and expanded rail states.
- `workspaces-switcher` is the header dropdown (`workspaces-switcher`) with `open-workspace` rows. The menu is portaled so the rail `overflow-hidden` does not clip it.
- `workspaces-templates` is hidden until `create-new-workspace`; then Blank (`workspace-template-blank`) or a pack chip (`workspace-template-general`, `workspace-template-legal`, …).
- `workspaces-modes` toggles tabs on `workspace-mode-picker` / `workspace-mode-<id>` (Chat stays on) inside `workspace-create-form`.
- `workspaces-create` opens with `create-new-workspace`, then creates a desk with `workspace-name` + `create-workspace`. Selected pack is posted as `templatePack`; `productModes` follow the chips. Cancel with `cancel-create-workspace`.
- `workspaces-list` shows desks on `workspace-list` with the pack label and mode summary.
- `workspaces-switch` opens a desk via `open-workspace` (selects it, then navigates to `/chat`).
- `workspaces-edit` opens with `edit-workspace-modes` (label Edit): rename on `workspace-edit-name`, chips on `workspace-edit-modes`, persist with `save-workspace-modes`.
- `workspaces-delete` is `delete-workspace` on non-Default desks. Default (`slug` home) has no delete control and `DELETE` returns 403. Confirm by clicking Delete, typing the desk name on `delete-workspace-confirm-name`, then `delete-workspace-confirm-submit`. The host also requires `confirmName`.

## How to get to it (user POV)

- Choose Workspaces on the left rail footer (`workspaces-link`) or open the switcher (`workspaces-switcher`).
- Webdev: open `http://127.0.0.1:3000/workspaces`. Packaged: same path on the ephemeral loopback URL.
- Collapse or expand the rail first if you need to prove both chrome states.
- After Create or Open the app goes to `/chat` for that desk.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- Prefer Cloud / throwaway SQLite when creating a workspace. On the operator's Windows desk, creating another workspace mutates their data — say so before clicking Create.

- **Expanded open.** With the rail expanded (`rail-collapse` visible), click `workspaces-link`. URL is `/workspaces` (15s). `create-new-workspace` and `workspace-list` are visible. `workspace-template-picker` count 0 until `create-new-workspace` is clicked; then Blank plus pack chips (including Legal) are visible.
- **Collapsed open.** Click `rail-collapse` if needed so the rail is collapsed (`rail-expand` visible). Click `workspaces-link` again. URL is still `/workspaces` (15s). Both rail branches must expose the same testid.
- **Switcher.** Click `workspaces-switcher`. `open-workspace` rows are visible.
- **Create (optional / Cloud).** Click `create-new-workspace`. Fill `workspace-name` with a unique name. Click `workspace-template-legal`. Confirm `workspace-mode-documents` and `workspace-mode-research` are selected; Images is off. Click `create-workspace`. URL becomes `/chat`. Rail shows Chat, Documents, Research, Presentation. `mode-images` and `mode-videos` count 0. `mode-agents` count 0.
- **Open.** Click an `open-workspace` control. The desk switches (rail workspace name updates) and `/chat` loads for that desk.
- **IDE proof.** Screenshot under `evidence/workspaces/<run-id>/` with `/workspaces` in the URL, chips visible, and the list showing the new desk.
- **Cloud.** Same steps via `page.getByTestId`.

## Gotchas

- Both collapsed and expanded `AppRail` branches must carry `data-testid="workspaces-link"` and `workspaces-switcher`. A single branch only is a harness bug.
- Workspaces is not a product mode. The page control is `workspaces-link`, not `mode-workspaces`.
- Create/Open navigate to `/chat`, not `/agents`.
- Kernel forbids `student` / `course` nouns in core schema. The Students chip is a pack id (`students`), not a kernel table.
- Do not create throwaway desks on the operator's Windows SQLite without asking.
- Default with null `productModes` after migrate is all work modes — not Chat-only.
- Isolation: Settings keys and extras are per desk. Knowledge soul/memory/sources were already per `workspaceId`. A new desk starts with no gateway key. The pre-isolation machine-wide key is claimed onto Default only.
