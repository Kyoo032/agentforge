# Workspaces

Workspaces is the owner's local project switcher: list desks on disk, create another, and open one. The left-rail Workspaces control must be reachable from both collapsed and expanded rail states via `workspaces-link`.

## Sub-features

- `workspaces-open` reaches `/workspaces` via `workspaces-link` from both collapsed and expanded rail states.
- `workspaces-create` creates a desk with `workspace-name` + `create-workspace`.
- `workspaces-list` shows desks on `workspace-list`.
- `workspaces-switch` opens a desk via `open-workspace`.

## How to get to it (user POV)

- Choose Workspaces on the left rail footer (`workspaces-link`).
- Webdev: open `http://127.0.0.1:3000/workspaces`. Packaged: same path on the ephemeral loopback URL.
- Collapse or expand the rail first if you need to prove both chrome states.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- Prefer Cloud / throwaway SQLite when creating a workspace. On the operator's Windows desk, creating another workspace mutates their data — say so before clicking Create.

- **Expanded open.** With the rail expanded (`rail-collapse` visible), click `workspaces-link`. URL is `/workspaces` (15s). `workspace-name`, `create-workspace`, and `workspace-list` are visible.
- **Collapsed open.** Click `rail-collapse` if needed so the rail is collapsed (`rail-expand` visible). Click `workspaces-link` again. URL is still `/workspaces` (15s). Both rail branches must expose the same testid.
- **Create (optional / Cloud).** Fill `workspace-name` with a unique name. Click `create-workspace`. `workspace-list` contains that name (15s).
- **Open.** Click an `open-workspace` control. The desk switches (rail workspace name updates or home mode loads for that desk).
- **IDE proof.** Screenshot under `evidence/workspaces/<run-id>/` with `/workspaces` in the URL and the list visible.
- **Cloud.** Same steps via `page.getByTestId`. Template-picker testids on this page land later — skip those asserts while absent.

## Gotchas

- Both collapsed and expanded `AppRail` branches must carry `data-testid="workspaces-link"`. A single branch only is a harness bug.
- Template picker testids on Workspaces land in a later phase — do not fail the drive while they are absent.
- Workspaces is not a product mode. The control is `workspaces-link`, not `mode-workspaces`.
- Do not create throwaway desks on the operator's Windows SQLite without asking.
