# Nultron Enterprise

> Nultron Enterprise is the hosted, multi-user edition of **Nultron**. Your team signs in from a browser, and there is nothing to install.
> Until the next release, the deploy files and the container image are still named **dpsbuddy-ent**. They are the same product.

This repository holds the release notes and the deploy bundle for each Enterprise release. It contains no source code. The desktop app for Windows and macOS is released at [Kyoo032/DPSBuddy](https://github.com/Kyoo032/DPSBuddy).

## What it is

Nultron is an AI workspace where each kind of work has its own screen in one app: chat, documents, research, finance, data, markets, legal review, meeting minutes, images, video, music, video editing and presentations. Each screen has its own instructions, tools and checks, and gives you a file you can keep. Nultron Enterprise runs that same workspace on a server for your whole organisation. Every person gets their own desks, and your organisation's data stays on the organisation's server.

| Mode | You give it | You get back |
|---|---|---|
| **Chat** | A question or a task | An answer. Web search, a calculator and your Knowledge Base are available as tools, and what it looked up is folded under **Thinking** |
| **Documents** | A prompt, optionally with source material | A structured document, downloadable as `.docx` |
| **Research** | A question | A sourced dossier with every claim linked to its source. Download it as Markdown, or turn it into a document or a presentation |
| **Finance** | Line items, typed or imported from `.xlsx` / `.csv` | A brief, ratios, a budget, a cash-flow view, or an investment appraisal. Figures are calculated by the app itself, not by the model. Export to `.xlsx`, `.pptx` or `.docx` |
| **Data** | A CSV, TSV or Excel file | An analysis with tables and charts. Every finding shows the query that produced it |
| **Market** | A watchlist of up to 15 tickers | A briefing from one of eleven market specialists, from Indonesian stocks to crypto, calculated by the app and carrying a not-financial-advice notice |
| **Legal** | `.docx` contracts for a matter | An issues memo, a tracked-changes redline, a deviation report and a red-flag list, checked against a clause playbook |
| **Meeting** | A recording, a live recording from the browser, or a transcript | A transcript and structured minutes (attendees, decisions, action items, risks, open questions) |
| **Images / Videos / Music** | A prompt | Generated images, clips and songs in a shared gallery |
| **Edit** | Clips and images | A timeline video editor with an assistant, and an approval step before export |
| **Presentation** | A prompt, optionally with source material | A slide outline, downloadable as `.pptx` |

Alongside the modes, every desk has a Knowledge Base, Workspaces with presets (Legal, Marketing, Students), Telegram Channels, Usage, and Settings. The whole app, and everything it writes, is available in English and Bahasa Indonesia.

## Signing in

- **There are no passwords.** People sign in with a one-time code sent to their work email.
- **Your organisation manages access.** Seats, plans and access are managed centrally. When a sign-in is refused, the app shows the reason in plain words, such as *all seats are taken*.
- **A gateway key still works.** Pasting a Toko Token gateway key from [api.tokotokenai.com](https://api.tokotokenai.com) runs the models directly.

## Security

- **Traffic is encrypted.** It is served over HTTPS only, behind a reverse proxy that obtains and renews its own certificate.
- **Secrets are encrypted at rest.** Keys and session tokens are stored with AES-256-GCM under a server key that comes from the environment. They never reach the browser.
- **Personal details are masked before a request leaves the server.** Email addresses, phone numbers, card and account numbers, names, and Indonesian identifiers (NIK and NPWP) are masked before any text is sent to a model.
- **Documents are read on the server.** There is no cloud OCR.
- **Prompts are not logged.** Message bodies and tool results are encrypted at rest.

## Get access

Nultron Enterprise is priced per user. To set up your organisation, contact DPS. Your team receives its sign-in details during onboarding.

## Deploying a release (operators)

Each release on `main` contains:

| File | What it is |
|---|---|
| `compose.yml` | The app plus a Caddy reverse proxy, with the container image pinned to this release |
| `.env.example` | Every variable the app refuses to start without |
| `DEPLOY.md` | The deploy, upgrade and rollback steps for this release |
| `Caddyfile` | The HTTPS reverse-proxy configuration |

In short:

1. Sign in to the container registry you were given access to.
2. Copy `.env.example` to `.env` and fill it in. Keep `.env` out of version control.
3. Point your domain's DNS at the server and open ports 80 and 443.
4. Run `docker compose pull && docker compose up -d`.
5. Wait until `docker compose ps` shows the app as `healthy`, then open your domain.

Back up the data volume before every upgrade, because the database only migrates forward. To roll back, deploy the previous release's bundle and restore that backup. `DEPLOY.md` in each release has the exact steps.

## Releases

Each update is published as a [GitHub Release](https://github.com/Kyoo032/DPSBuddy-Ent/releases), with release notes and the image it pins. Organisations hosted by DPS receive updates automatically.

No release has been published yet.

## Feedback

You can raise questions about a release on the [issues page](https://github.com/Kyoo032/DPSBuddy-Ent/issues). For access, accounts or billing, contact DPS.

---

Nultron is a trademark of Muhammad Rizky Rahmatullah. Copyright 2026 Muhammad Rizky Rahmatullah. Licensed under the [Apache License 2.0](LICENSE).
