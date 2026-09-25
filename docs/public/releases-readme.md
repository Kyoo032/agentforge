# Nultron

> **Downloads:** Nultron for Windows and macOS. The current release is **0.15.0**, and the app is under active development.
> Until the next release the app, its installers and its data folders are still named **DPSBuddy**. They are the same app.
> Teams can also use **Nultron Enterprise**, a hosted web version you sign in to from a browser. Contact DPS for access.

Nultron is a desktop AI workspace. Each kind of work has its own screen in one app: chat, documents, research, finance, data, markets, legal review, meeting minutes, images, video, music, video editing and presentations. Each screen has its own instructions, tools and checks, and gives you a file you can keep. Your threads, files and settings are stored on your own computer.

This repository holds installers and update feeds only. It contains no source code.

## What you can do with it

| Mode | You give it | You get back |
|---|---|---|
| **Chat** | A question or a task | An answer. Web search, a calculator and your Knowledge Base are available as tools, and what it looked up is folded under **Thinking** |
| **Documents** | A prompt, optionally with source material | A structured document, previewed in the app and downloadable as `.docx` |
| **Research** | A question | A sourced dossier. The question is split into sub-questions, searched and read, and every claim is linked to its source. Download it as Markdown, save it to the Knowledge Base, or turn it into a document or a presentation |
| **Finance** | Line items, typed or imported from `.xlsx` / `.csv` | One of five tasks: a financial brief, ratios, a budget, a cash-flow view, or an investment appraisal (NPV, IRR, payback). The figures are calculated by the app itself, not by the model. The model writes the explanation, and any figure it cannot trace is flagged. Export to `.xlsx`, `.pptx` or `.docx` |
| **Data** | A CSV, TSV or Excel file (up to 25 MB) | An analysis with tables and charts. Every finding shows the query that produced it |
| **Market** | A watchlist of up to 15 tickers | A market briefing from one of eleven specialists: Indonesian stocks, forex, gold, crypto, commodities, global indices, sector rotation, a scanner, a daily summary, Elliott Wave counts, and a news digest. Prices, indicators and charts are calculated by the app, and every briefing carries a not-financial-advice notice |
| **Legal** | `.docx` contracts for a matter | An issues memo, a tracked-changes redline, a deviation report in `.xlsx`, and a red-flag list, all checked against a clause playbook |
| **Meeting** | A recording, a live recording from your microphone (and optionally a browser tab), or a pasted transcript | A transcript and structured minutes: attendees, decisions, action items, risks and open questions, in English and Bahasa Indonesia |
| **Images** | A prompt | Generated images in a gallery |
| **Videos** | A prompt, an aspect ratio and an optional still image | Generated clips in a gallery, with a cost estimate before you start |
| **Music** | A description, or your own lyrics, style and title | Two takes per request, saved to your gallery |
| **Edit** | Your clips and images | A timeline video editor with an assistant that can add and arrange clips for you. You approve before it exports |
| **Presentation** | A prompt, optionally with source material | A slide outline, previewed in the app and downloadable as `.pptx` |

Alongside the modes:

- **Knowledge Base.** Add `.txt`, `.md`, `.csv`, `.json`, `.html`, `.pdf`, `.docx`, `.pptx` and `.xlsx` files. Nultron indexes them on your computer and uses them to answer questions. Results from other modes can be saved here too.
- **Workspaces.** Set up separate desks, each showing only the modes you need. Presets are included for Legal, Marketing and Students. The default desk shows every mode.
- **Channels.** Connect a Telegram bot to post to your groups and channels, and fetch replies when you choose to.
- **Usage.** Your spend by day, week or month, broken down by model.
- **Languages.** The whole app, and everything it writes for you, is available in English and Bahasa Indonesia. Change it in **Settings**.

## What you need

- **A Toko Token gateway key** from [api.tokotokenai.com](https://api.tokotokenai.com). Paste it once during setup. That one key runs chat, image, video and music generation. Model usage is billed by the gateway.
- Windows 10 or 11 (64-bit), or macOS on Apple silicon or Intel.
- An internet connection for model work. The app itself opens offline, and a key that was checked in the last 7 days keeps working without a connection.

On first launch Nultron may download a document reader it needs. The download comes from a fixed source and is verified before it is installed. You don't need to install anything yourself.

## Privacy

- **Your data stays on your computer.** Threads, files, datasets and the Knowledge Base are kept in a local database in the app's data folder.
- **Your key is encrypted.** It is stored with AES-256-GCM. The encryption key is kept in Windows Credential Manager or the macOS Keychain, and the key is never shown again after you save it.
- **Personal details are masked before a request leaves your computer.** Email addresses, phone numbers, card and account numbers, names, and Indonesian identifiers (NIK and NPWP) are replaced before the text is sent to a model. Finance masks identifiers but never amounts.
- **Documents are read on your computer.** There is no cloud OCR. A scanned PDF with no text layer is declined instead of being uploaded.
- **Nultron does not log your prompts.** Messages and tool results are encrypted on disk. What the gateway keeps is set by the gateway's own policy.
- **It only connects to what you use.** That means the model gateway, the market and search sources a mode needs, Telegram if you connect it, and the verified download on first launch.

## Download

From the [latest release](https://github.com/Kyoo032/DPSBuddy/releases/latest):

| Platform | File |
|---|---|
| Windows 10 / 11, 64-bit | `DPSBuddy-Setup-<version>.exe` |
| macOS, Apple silicon (M1 and later) | `DPSBuddy-<version>-mac-arm64.dmg` |
| macOS, Intel | `DPSBuddy-<version>-mac-x64.dmg` |

A release without `.dmg` files is Windows-only. The macOS build is a preview and is not attached to every release.

## Install on Windows

- The installer is not code-signed yet. If SmartScreen shows "Windows protected your PC", choose **More info → Run anyway**.
- Installing over an existing copy upgrades it in place. Your threads, settings and saved key are kept.
- The app updates itself from this repository. **Settings → Check for updates** downloads new releases from here.
- Video editing uses ffmpeg, which is included in the installer.

## Install on macOS (preview)

- Open the `.dmg` and drag **DPSBuddy** to Applications.
- The app is not signed by Apple yet.
  - On macOS 15 and later: double-click it, dismiss the warning, then go to **System Settings → Privacy & Security → Open Anyway**.
  - On macOS 14 and earlier: right-click **DPSBuddy.app**, choose **Open**, then **Open** again.
  - If macOS still refuses, run `xattr -dr com.apple.quarantine /Applications/DPSBuddy.app` in Terminal.
- When macOS asks about the Keychain, choose **Always Allow**.
- Video editing needs ffmpeg on macOS: run `brew install ffmpeg`. Everything else works without it. If Edit still shows the setup banner, press **Check again** in it. No restart is needed.
- Updates on macOS are manual: download the new `.dmg` from here and drag it over the old app. Your data stays in `~/Library/Application Support/DPSBuddy`.

## Uninstall

- **Windows:** uninstalling removes the app, its local data folder and the saved gateway key. If you reinstall, you start again from setup.
- **macOS:** drag **DPSBuddy.app** to the Trash. To start fresh, also delete `~/Library/Application Support/DPSBuddy` and the `DPSBuddy` item in Keychain Access.

## Feedback

You can report problems with an installer or an update on the [issues page](https://github.com/Kyoo032/DPSBuddy/issues).

---

Nultron is a trademark of Muhammad Rizky Rahmatullah. Copyright 2026 Muhammad Rizky Rahmatullah. Licensed under the Apache License 2.0.
