# Demo runbook

The demo surface is **Chrome at `http://127.0.0.1:3000`**, not the desktop shell.

## Before you present

1. Close the Electron window if it is open. It is parked for the demo — do not present from it.
2. From the repo root: `pnpm dev`
3. Open Chrome (not Cursor's IDE browser — the Next dev overlay can inject attributes and steal clicks) at `http://127.0.0.1:3000/chat`.

## What works in the demo

- **Chat send works with no key saved.** `AGENTFORGE_RUNTIME=stub` (the default until a gateway key is saved) replies locally, so the composer, threads, and tool echo all demo fine offline.
- **Settings** loads fast: the Extras section renders its provider keys, tool toggles, and model selects only after you open it. Closed Settings is just gateway URL + key + privacy + runtime.
- **Live generation** (chat against the gateway, image/video) only works if a gateway key is saved on the machine you demo from. Paste it in Settings beforehand; never paste it on a shared/Cloud machine.

## If something feels slow

- First compile of a route in dev is cold — click through Chat, Settings, and Build once before presenting.
- If you accidentally opened the app in Cursor's IDE browser and clicks seem dead, switch to Chrome.
