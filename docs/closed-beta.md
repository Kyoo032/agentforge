# Closed beta checklist

For invited testers. Use the **installed app** — Windows Setup exe or macOS dmg from [Releases](https://github.com/Kyoo032/agentforge/releases). Do not clone the repo or run a local web server.

## Before you start

1. Download the installer for your OS from [v0.1.0](https://github.com/Kyoo032/agentforge/releases/tag/v0.1.0) (Windows exe is up; macOS dmg when published)
2. Install and open **Agentforge** from the Start menu (Windows) or Applications (macOS)
3. Paste your Toko Token gateway key in **Settings** when you want live models

Without a key, Chat still works in offline demo mode.

Windows SmartScreen may warn because the installer is unsigned. **More info** → **Run anyway** if you trust this build.

## What to try

- **Chat** — send a message, switch models, open a second thread
- **Settings** — save gateway key, confirm the UI does not echo the raw key back
- **Documents / Research / Images / Videos / Presentation** — one happy-path generate each (live key required for media)
- **Workspaces** — create a desk, switch tabs, return to Home

## Notes

- There is no mobile app. Agentforge is local to your machine — [`docs/mobile.md`](mobile.md).
- First launch can take up to a minute while the bundled server starts.

## Secrets

Never paste a production gateway key into a shared machine, a PR comment, or git. Keep keys on the machine you own.
