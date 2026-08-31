# Desktop

Electron starts the local Next app on loopback when port 3000 is empty, loads the window at `http://127.0.0.1:3000`, and tears down the child on quit. Wrap key and user-data dir match the product rules in the main skill.

## Sub-features

- `desktop-launch` opens Agentforge via `pnpm desktop:dev` without a separate terminal when `:3000` is free.
- `desktop-splash` shows the splash page until loopback answers.
- `desktop-chat` loads Chat after the port is ready.
- `desktop-reuse` attaches to an existing Next on `:3000` without spawning a second server.
- `desktop-quit` kills the Next child only if Electron started it.

## How to get to it (user POV)

- From repo root: `pnpm desktop:dev`.
- Installed NSIS build (prototype): launch Agentforge from Start menu — same loopback URL when spawn succeeds.

## Driving it with the Agentforge harness

Preconditions:

- Repo root, `pnpm install` and `pnpm db:push` done at least once for dev.
- Prefer an idle port 3000 for a clean spawn proof. If `pnpm dev` is already running, record `desktop-reuse` instead of `desktop-launch`.
- Do not run Playwright on Windows for this feature.

- **Launch.** Run `pnpm desktop:dev` from repo root. An Electron window opens (1280×800). Splash then Chat at `http://127.0.0.1:3000/chat` within ~20s.
- **Doctor.** `node .cursor/skills/verify-agentforge/scripts/doctor.mjs` exits 0 against loopback.
- **Chat.** `model-picker` and `composer` visible (same as [chat.md](./chat.md)).
- **Settings.** Navigate to `/settings` in the window or IDE browser; `settings-form` visible.
- **Quit.** Close the window. If Electron spawned Next, the child exits (no orphan on 3000). If you reused an existing dev server, that server keeps running — say so in evidence.
- **IDE proof.** Screenshot of the Electron window on Chat under `evidence/desktop/<run-id>/`.

## Gotchas

- Packaged installer does not embed Node or the monorepo yet. Dev proof is `pnpm desktop:dev`.
- When Electron spawns Next, it runs `drizzle-kit push --force` on `userData` first. Reusing an existing `pnpm dev` uses that server's data dir instead.
- keytar may fall back to a session-only wrap key if Credential Manager is unavailable — doctor still works; note it in evidence.
- Never put `AGENTFORGE_SECRETS_KEY` in the renderer or `NEXT_PUBLIC_*`.
- Single-instance: a second launch focuses the existing window.
- Cursor browser overlay can steal clicks; the Electron window itself is the primary proof surface for desktop.
- Close and relaunch after a desktop:dev change — an old window can still be showing Next's full-page error overlay, which eats every click.
