# DPSBuddy

**Closed beta.** One app, many work harnesses, on the [Toko Token](https://api.tokotokenai.com) OpenAI-compatible gateway.

The goal is multi-harness inside one app. Each kind of work is its own harness: its own screen, its own checks, and a file you can take with you. Chat, documents, research, finance, data, market, legal, meetings, images, video, music, edit, and presentations all live here. A new kind of work is another harness in this app. Custom-agent building stays parked. Hermes stays the separate tinkering surface.

> Do not confuse **Toko Token** (`api.tokotokenai.com`) with TokenKu.

## Two ways to run it

DPSBuddy ships as two products from this one repository. They share the same app and the same harnesses; they differ in where your work lives.

| | **Personal** | **Enterprise** |
|---|---|---|
| What it is | The Mac/Windows app | The hosted web app |
| Where your work lives | On your own computer | In your organisation's tenant on the server |
| How you get in | Install it and paste a gateway key | Ask for an invite, then sign in with a one-time code |
| Ships as | `DPSBuddy-Setup-0.15.0.exe` and the macOS `.dmg` | A hosted URL |

**Personal — the Mac/Windows app (current cut 0.15.0).** Download and install it, then paste your Toko Token gateway key in Settings. Your chats, files and generated media stay on your machine. No account is needed and nothing is uploaded anywhere except the model calls themselves.

**Enterprise — the hosted web app.** Ask the operator for an invite, open the hosted URL, and sign in through the portal with a one-time code. Your work stays in your tenant on the server. A pasted gateway key still works here as the floor for model calls; the portal sign-in is the account.

Both run every harness below. Node and pnpm are not required to use either one.

## Harnesses

| Harness | What you leave with |
|---------|---------------------|
| **Chat** | A conversation, with a model picker |
| **Documents** | A DOCX |
| **Research** | Sourced notes and a Markdown dossier |
| **Finance** | Figures computed in the app, then a brief you can export |
| **Data** | An analysis of a table you uploaded, with the SQL shown |
| **Market** | A watchlist briefing |
| **Legal** | A memo, a redline, and a deviation report from your documents |
| **Meeting** | A transcript and minutes |
| **Images** | Generated images |
| **Videos** | Generated videos |
| **Music** | Generated tracks |
| **Edit** | A timeline cut you export |
| **Presentation** | An outline, an HTML preview, and a PPTX |

Both products also have Knowledge Base, Channels, Workspaces, Usage, and Settings. Those belong to the desk. Workspaces are optional extra desks (Legal, Marketing, Students, or your own set of harnesses). The default desk already includes every harness.

With no gateway key and no portal session, Chat stays in demo mode.

Invited testers: [`docs/closed-beta.md`](docs/closed-beta.md). There is no mobile app — [`docs/mobile.md`](docs/mobile.md).

## Privacy (closed beta)

- **Personal:** the gateway key and your work are encrypted at rest on your own machine. The wrap key lives in your OS keychain.
- **Enterprise:** the gateway key and your work are encrypted at rest on the server. The wrap key is the server's secret manager, never a file in this repo.
- Message bodies and tool I/O are encrypted at rest either way.
- Browser traffic is HTTPS only; remote inference URLs must be HTTPS.

Never share your gateway key, and never paste it anywhere but Settings.

## Status

Closed beta. Sharp edges, APIs that may change, invite-only access. Feedback from invited testers goes to the operator — this is not a public support channel yet.

## Develop

Repo and agent rules: [`AGENTS.md`](AGENTS.md). That file opens with the Personal/Enterprise split — read it first, because a change to packaging, identity or the deploy path lands on only one of the two products.

```
pnpm install
pnpm dev          # http://127.0.0.1:3000 — the shared renderer
pnpm test         # Vitest
pnpm lint         # Biome
```

**Personal (Mac/Windows):** `pnpm desktop:build` produces the Windows installer; `desktop:build:mac` and `desktop:mac` need a Mac. `apps/desktop` compiles `apps/web` into the installer, so most UI work lands in both products at once.

**Enterprise (hosted):** `pnpm --filter web build`, then run the host behind the reverse proxy. Deploys are tracked by commit sha.

There is no mobile app.

## License

Copyright 2026 Muhammad Rizky Rahmatullah. Licensed under the [Apache License 2.0](LICENSE).