# DPS Agent Platform

Desktop releases for **Agentforge**, the local-first agent workspace by DPS. This repository hosts installers and update feeds only; it contains no source code.

## Download

From the [latest release](https://github.com/Kyoo032/DPS-Agent-Platform/releases/latest):

| Platform | File |
|---|---|
| Windows 10 / 11, 64-bit | `Agentforge-Setup-<version>.exe` |
| macOS, Apple silicon (M1 and later) | `Agentforge-<version>-mac-arm64.dmg` |
| macOS, Intel | `Agentforge-<version>-mac-x64.dmg` |

A release without `.dmg` files is Windows-only; the macOS build is a preview and is not attached to every release.

## Install on Windows

- The installer is not code-signed yet. If SmartScreen shows "Windows protected your PC", choose **More info → Run anyway**.
- Installing over an existing copy upgrades it in place. Your threads, settings, and saved key are kept.
- The app updates itself from this repository: **Settings → Check for updates** inside Agentforge downloads new releases from here.

## Install on macOS (preview)

- Open the `.dmg` and drag **Agentforge** to Applications.
- The app is not signed by Apple yet. On macOS 15 and later: double-click it, dismiss the warning, then **System Settings → Privacy & Security → Open Anyway**. On macOS 14 and earlier: right-click **Agentforge.app**, choose **Open**, then **Open** again. If it still refuses, run `xattr -dr com.apple.quarantine /Applications/Agentforge.app` in Terminal.
- When macOS asks about the Keychain, choose **Always Allow**.
- Video editing needs ffmpeg on macOS: `brew install ffmpeg`. Everything else works without it. The app finds the Homebrew install on its own (both `/opt/homebrew/bin` and `/usr/local/bin`); if Edit still shows the setup banner, press **Check again** in it. No restart needed. On Windows the installer bundles ffmpeg; `winget install --id Gyan.FFmpeg -e` also works and is picked up automatically.
- Updates on macOS are manual: download the new `.dmg` from here and drag it over the old app. Your data stays in `~/Library/Application Support/Agentforge`.

## Uninstall

Windows: uninstalling removes the app, its local data folder, and the saved gateway key. Reinstalling afterwards starts fresh with onboarding.

macOS: drag **Agentforge.app** to the Trash. To start fresh, also delete `~/Library/Application Support/Agentforge` and the `Agentforge` item in Keychain Access.

## Feedback

Problems with an installer or update can be reported on the [issues page](https://github.com/Kyoo032/DPS-Agent-Platform/issues).

---

© DPS. The installers in this repository are proprietary software; this repository distributes binaries only.
