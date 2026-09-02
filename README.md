# Agentforge

**Closed beta.** A local workbench for the [Toko Token](https://api.tokotokenai.com) OpenAI-compatible gateway.

Install it on your machine, paste a gateway API key, and work. No account. No cloud tenant. Your chats, workspaces, and media stay on disk.

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

Settings holds the gateway key (and optional extras). Keys never leave the host process after save.

> Do not confuse **Toko Token** (`api.tokotokenai.com`) with TokenKu.

## Requirements

- Node.js 20+
- pnpm 9.15.9
- A Toko Token gateway API key for live models (optional for stub/offline smoke)
- **Windows installer builds:** Developer Mode (or an elevated shell) for Next standalone symlinks

## Quick start (webdev)

```bash
npx pnpm@9.15.9 install
npx pnpm@9.15.9 dev
```

Open [http://127.0.0.1:3000/chat](http://127.0.0.1:3000/chat). No login.

1. Open **Settings**
2. Paste your gateway API key
3. Start in **Chat**

Until a key is saved, the app runs in stub mode so the UI is usable offline.

```bash
# optional seed data
npx pnpm@9.15.9 db:seed
```

SQLite lives at `data/agentforge.sqlite` (or `AGENTFORGE_DATA_DIR`). Do not set `DATABASE_URL` to Postgres.

## Desktop app

| Mode | Command | Bind | Data |
|------|---------|------|------|
| Webdev window | `pnpm desktop:dev` | `:3000` (may reuse `pnpm dev`) | repo `data/` |
| Packaged install | `pnpm desktop:build` | ephemeral loopback **≠ 3000** | Electron userData |

```bash
pnpm desktop:dev          # Electron around local webdev
pnpm desktop:build        # Windows NSIS (product path)
pnpm desktop:build:mac    # run on macOS
pnpm desktop:build:linux  # run on Linux
```

Packaged Agentforge never reuses port 3000. Details: [`apps/desktop/README.md`](apps/desktop/README.md).

## Repo layout

```
apps/web            Next.js UI + /api/v1 (local owner, loopback only)
apps/desktop        Electron shell + installer
packages/core       Runtime, tools, product modes
packages/db         SQLite schema + migrations
packages/legal      Optional Legal workspace pack
packages/marketing  Optional Marketing workspace pack
packages/university Optional Students workspace pack
docs/               Product docs (see below)
```

## Docs

- [`docs/product-modes.md`](docs/product-modes.md) — nav modes and packs
- [`docs/mobile.md`](docs/mobile.md) — desktop / loopback only (no mobile app)
- [`docs/closed-beta.md`](docs/closed-beta.md) — tester checklist
- [`apps/desktop/README.md`](apps/desktop/README.md) — installer and ports

Engineering notes live under [`docs/internal/`](docs/internal/).

## Privacy (closed beta)

- Gateway key → encrypted `settings.enc` (AES-256-GCM)
- Wrap key → OS keychain (Electron) or local `data/.master-key` (webdev)
- Message bodies and tool I/O encrypted at rest on your machine
- Remote inference URLs must be HTTPS (loopback `http://` only for local models such as Ollama)
- Never commit `.env`, `data/settings.enc`, or `data/.master-key`

## Status

This repository is in **closed beta**. Expect sharp edges, unsigned Windows installs, and APIs that may still change. Feedback from invited testers goes to the operator — this is not a public support channel yet.

## License

Proprietary / closed beta. All rights reserved unless a LICENSE file is added later.
