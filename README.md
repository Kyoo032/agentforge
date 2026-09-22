# DPSBuddy

**Closed beta.** One hosted app, many work harnesses, on the [Toko Token](https://api.tokotokenai.com) OpenAI-compatible gateway.

The goal is multi-harness inside one app. You sign in once. Each kind of work is its own harness in that same app: its own screen, its own checks, and a file you can take with you. Chat, documents, research, finance, data, market, legal, meetings, images, video, music, edit, and presentations all live here. A new kind of work is another harness in this app. Custom-agent building stays parked. Hermes stays the separate tinkering surface.

You open it in a browser. Chats, files, and media stay in your tenant on the server.

> Do not confuse **Toko Token** (`api.tokotokenai.com`) with TokenKu.

## Access

DPSBuddy runs as a hosted web app. There is nothing to download and nothing to install.

1. Ask the operator for an invite
2. Open the hosted URL in your browser
3. Sign in through the portal with a one-time code

The hosted URL is handed out with the invite. Node and pnpm are not required, and you do not need a clone of this repo.

A Toko Token gateway key can still be pasted in Settings. That key is what runs the models. The portal sign-in is the account.

Windows and macOS installers still exist as a frozen **0.14.27** desktop build on the [DPSBuddy releases page](https://github.com/Kyoo032/DPSBuddy/releases). That build is maintenance-only. The product continues in the browser.

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

The same account also has Knowledge Base, Channels, Workspaces, Usage, and Settings. Those belong to the desk. Workspaces are optional extra desks (Legal, Marketing, Students, or your own set of harnesses). The default desk already includes every harness.

On a desk with no gateway key and no portal session, Chat stays in demo mode.

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

Repo and agent rules: [`AGENTS.md`](AGENTS.md). The goal for anyone changing the code is the same one above: a new kind of work is a new harness in this app.

```
pnpm install
pnpm dev          # http://127.0.0.1:3000
pnpm test         # Vitest
pnpm lint         # Biome
```

Desktop (frozen at 0.14.27): the `pnpm desktop:*` commands still build the Electron app for maintenance cuts only; `desktop:build:mac` and `desktop:mac` need a Mac. There is no mobile app.

## License

Copyright 2026 Muhammad Rizky Rahmatullah. Licensed under the [Apache License 2.0](LICENSE).
