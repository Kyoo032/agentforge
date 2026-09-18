# Closed beta checklist

For invited testers. DPSBuddy is a **hosted web app**: you use it in your browser. There is nothing to install, and you do not clone this repo or run a local server.

## Before you start

1. Ask the operator for an invite and the hosted URL (it is not public)
2. Open the URL in a current browser on a desktop or laptop
3. Sign in through the Toko Token portal
4. Paste your Toko Token gateway key in **Settings** when you want live models

Without a key, Chat still works in offline demo mode.

## What to try

- **Chat** — send a message, switch models, open a second thread
- **Settings** — save gateway key, confirm the UI does not echo the raw key back
- **Documents / Research / Images / Videos / Presentation** — one happy-path generate each (live key required for media)
- **Workspaces** — create a desk, switch tabs, return to Default

## Notes

- There is no mobile app, and a phone browser is untested — [`docs/mobile.md`](mobile.md).
- Report anything broken to the operator with the mode, what you did, and what you expected. Screenshots help. This is not a public support channel.

## Secrets

Never paste a production gateway key into a shared machine, a PR comment, or git. Treat your invite and your key as yours alone.
