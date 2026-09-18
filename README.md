# DPSBuddy

**Closed beta.** A hosted, multi-user workbench for the [Toko Token](https://api.tokotokenai.com) OpenAI-compatible gateway.

You open it in a browser, sign in, and work. Your chats, workspaces, and media live in your own tenant on the server.

> Do not confuse **Toko Token** (`api.tokotokenai.com`) with TokenKu.

## Access

DPSBuddy runs as a hosted web app. There is nothing to download and nothing to install.

1. Ask the operator for an invite
2. Open the hosted URL in your browser
3. Sign in through the Toko Token portal

The hosted URL is not public yet — it is handed out with the invite. Node and pnpm are not required, and you do not need a clone of this repo.

Windows and macOS installers still exist as a frozen **0.14.27** desktop build on the [DPSBuddy releases page](https://github.com/Kyoo032/DPSBuddy/releases); that build is maintenance-only and is not where the product continues.

## After you sign in

1. Open **Settings**
2. Paste your Toko Token gateway API key
3. Start in **Chat**

Until a key is saved, Chat still works in offline demo mode.

## What you get

| Mode | What it does |
|------|----------------|
| **Chat** | Model picker + composer against the gateway |
| **Documents** | Prompt → preview → download DOCX |
| **Research** | Question → web search → sourced notes → Markdown |
| **Images** | Prompt → generate → gallery |
| **Videos** | Prompt → generate → gallery |
| **Presentation** | Prompt → outline → HTML preview + PPTX |
| **Workspaces** | Optional desks (Legal, Marketing, Students, or custom tabs) |

Settings holds the gateway key. The raw key never comes back after save.

Invited testers: [`docs/closed-beta.md`](docs/closed-beta.md). There is no mobile app — [`docs/mobile.md`](docs/mobile.md).

## Privacy (closed beta)

- Gateway key → encrypted at rest on the server (AES-256-GCM envelope)
- Wrap key → the server's secret manager, never a file in this repo
- Message bodies and tool I/O encrypted at rest on the server
- Browser traffic is HTTPS only; remote inference URLs must be HTTPS

Never share your gateway key, and never paste it anywhere but Settings.

## Status

Closed beta. Sharp edges, APIs that may change, invite-only access. Feedback from invited testers goes to the operator — this is not a public support channel yet.

## Develop

Repo and agent rules: [`AGENTS.md`](AGENTS.md).

```
pnpm install
pnpm dev          # http://127.0.0.1:3000
pnpm test         # Vitest
pnpm lint         # Biome
```

Desktop (frozen at 0.14.27): the `pnpm desktop:*` commands still build the Electron app for maintenance cuts only; `desktop:build:mac` and `desktop:mac` need a Mac. There is no mobile app.

## License

Copyright 2026 DPS. Licensed under the [Apache License 2.0](LICENSE).
