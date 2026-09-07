# Agentforge

**Closed beta.** A local workbench for the [Toko Token](https://api.tokotokenai.com) OpenAI-compatible gateway.

Install it on your machine, paste a gateway API key, and work. No account. No cloud tenant. Your chats, workspaces, and media stay on disk.

> Do not confuse **Toko Token** (`api.tokotokenai.com`) with TokenKu.

## Download and install

You need the installer, not a clone of this repo. Node and pnpm are not required.

| OS | Installer |
|----|-----------|
| **Windows** | [Agentforge Setup 0.1.0.exe](https://github.com/Kyoo032/agentforge/releases/download/v0.1.0/Agentforge.Setup.0.1.0.exe) (~168 MB, unsigned) |
| **macOS** | `.dmg` not published yet. It must be built on a Mac; it will land on the [same Releases page](https://github.com/Kyoo032/agentforge/releases/tag/v0.1.0) when it exists. |

Windows: run the Setup exe, then open **Agentforge** from the Start menu.

The installer is unsigned. Windows SmartScreen may warn; that is expected in closed beta. Choose **More info** → **Run anyway** if you trust the operator who sent you this build.

All current builds: [Releases](https://github.com/Kyoo032/agentforge/releases).

## After install

1. Open Agentforge
2. Open **Settings**
3. Paste your Toko Token gateway API key
4. Start in **Chat**

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

- Gateway key → encrypted `settings.enc` (AES-256-GCM)
- Wrap key → OS keychain
- Message bodies and tool I/O encrypted at rest on your machine
- Remote inference URLs must be HTTPS (loopback `http://` only for local models such as Ollama)

Never share `.env`, `settings.enc`, or your gateway key.

## Status

Closed beta. Unsigned Windows installs, sharp edges, APIs that may change. Feedback from invited testers goes to the operator — this is not a public support channel yet.

## Develop

Repo and agent rules: [`AGENTS.md`](AGENTS.md).

```
pnpm install
pnpm dev          # http://127.0.0.1:3000
pnpm test         # Vitest
pnpm lint         # Biome
pnpm desktop:build
```

`pnpm desktop:build:mac` and `pnpm desktop:mac` need a Mac. There is no mobile app.

## License

Proprietary / closed beta. All rights reserved unless a LICENSE file is added later.
