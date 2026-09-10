# Mobile

DPSBuddy is a **local desktop / loopback** workbench. There is no iOS or Android app.

- No App Store or Play Store listing.
- No Capacitor, React Native, or Cordova project in this repo.
- No electron-builder mobile target. Desktop targets are Windows NSIS, mac dmg/zip, and linux AppImage/deb only.

A phone or tablet browser hitting a LAN `:3000` is **not** a product surface. Webdev binds `127.0.0.1:3000`. Packaged Electron has no HTTP server (IPC only). Other devices on the network cannot reach Chat, and that is intentional.

The mobile client is being built in-repo under [`apps/mobile`](../apps/mobile/AGENTS.md) (Expo, Android first, iOS after), as a direct gateway client, not a kernel change and not part of the desktop installer. Its rules live in that folder's `AGENTS.md`; read them before adding any React Native, Xcode, or Simulator work. This Windows checkout cannot run Apple’s Simulator. Plan: [`docs/internal/mobile-android-plan.md`](internal/mobile-android-plan.md).

See the desktop shell: [`apps/desktop/README.md`](../apps/desktop/README.md). Verification map: [`.cursor/skills/verify-agentforge/features/mobile.md`](../.cursor/skills/verify-agentforge/features/mobile.md).
