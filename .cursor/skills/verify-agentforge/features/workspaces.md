# Workspaces

Workspaces is the owner's local project switcher: list desks on disk, create another from a template (or blank), and open one. The left-rail Workspaces control must be reachable from both collapsed and expanded rail states via `workspaces-link`. Creating with a template seeds one starter agent.

## Sub-features

- `workspaces-open` reaches `/workspaces` via `workspaces-link` from both collapsed and expanded rail states.
- `workspaces-templates` picks Blank (`workspace-template-blank`) or a pack chip (`workspace-template-organisation`, `workspace-template-students`, `workspace-template-office`, `workspace-template-legal`, `workspace-template-sales`, `workspace-template-marketing`, `workspace-template-product`).
- `workspaces-create` creates a desk with `workspace-name` + `create-workspace`. A selected pack is posted as `templatePack`; Blank omits it.
- `workspaces-seed` — a pack create returns `seeded: true` and publishes one starter (e.g. office → "Office assistant"). Blank returns `seeded: false`.
- `workspaces-list` shows desks on `workspace-list` with the pack label next to the name.
- `workspaces-switch` opens a desk via `open-workspace` (selects it, then navigates to `/agents`).

## How to get to it (user POV)

- Choose Workspaces on the left rail footer (`workspaces-link`).
- Webdev: open `http://127.0.0.1:3000/workspaces`. Packaged: same path on the ephemeral loopback URL.
- Collapse or expand the rail first if you need to prove both chrome states.
- After Create or Open the app goes to `/agents` for that desk. `/agents` is a core surface — it must not bounce to `/chat` even when the Agents rail tab is off.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- Prefer Cloud / throwaway SQLite when creating a workspace. On the operator's Windows desk, creating another workspace mutates their data — say so before clicking Create.

- **Expanded open.** With the rail expanded (`rail-collapse` visible), click `workspaces-link`. URL is `/workspaces` (15s). `workspace-template-picker`, `workspace-name`, `create-workspace`, and `workspace-list` are visible. Blank plus the seven pack chips above are visible.
- **Collapsed open.** Click `rail-collapse` if needed so the rail is collapsed (`rail-expand` visible). Click `workspaces-link` again. URL is still `/workspaces` (15s). Both rail branches must expose the same testid.
- **Create (optional / Cloud).** Fill `workspace-name` with a unique name. Click `workspace-template-office` (or another pack). Click `create-workspace`. URL becomes `/agents` and stays there (do not accept a bounce to `/chat`). `agent-catalog` lists the seeded starter (office → "Office assistant"). Return to `/workspaces`; `workspace-list` contains that name and an Office label.
- **Blank create.** Name + `workspace-template-blank` + Create. `/agents` may be empty of custom agents; list still shows the new desk with no pack label.
- **Open.** Click an `open-workspace` control. The desk switches (rail workspace name updates) and `/agents` loads for that desk.
- **IDE proof.** Screenshot under `evidence/workspaces/<run-id>/` with `/workspaces` in the URL, chips visible, and the list showing the new desk.
- **Cloud.** Same steps via `page.getByTestId`.

## Gotchas

- Both collapsed and expanded `AppRail` branches must carry `data-testid="workspaces-link"`. A single branch only is a harness bug.
- Workspaces is not a product mode. The control is `workspaces-link`, not `mode-workspaces`.
- Create/Open navigate to `/agents`. `ModeRedirect` must leave `/agents` alone; only `/images`, `/videos`, `/documents`, `/research`, `/presentations` bounce when hidden.
- Playwright cookie/workspace context: listing agents without the workspace cookie shows the previous desk. Drive through the UI (or `page.request` in the same browser context) so the cookie sticks.
- Kernel forbids `student` / `course` nouns in core schema. The Students chip is a pack id (`students`), not a kernel table.
- Do not create throwaway desks on the operator's Windows SQLite without asking.
