# Mobile

Agentforge is a **local desktop / loopback** workbench. There is no iOS or Android app.

- No App Store or Play Store listing.
- No Capacitor, React Native, or Cordova project in this repo.
- No electron-builder mobile target. Desktop targets are Windows NSIS, mac dmg/zip, and linux AppImage/deb only.

A phone or tablet browser hitting a LAN `:3000` is **not** a product surface. Webdev binds `127.0.0.1:3000`. Packaged Electron binds an ephemeral loopback port and never reuses `:3000`. Other devices on the network cannot reach Chat, and that is intentional.

A later phone/tablet surface would be a new optional pack, not a kernel change and not part of the current desktop installer work.

See the desktop shell: [`apps/desktop/README.md`](../apps/desktop/README.md). Verification map: [`.cursor/skills/verify-agentforge/features/mobile.md`](../.cursor/skills/verify-agentforge/features/mobile.md).
