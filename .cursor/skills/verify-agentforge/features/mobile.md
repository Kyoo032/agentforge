# Mobile

There is no DPSBuddy iOS or Android app. No App Store / Play listing, no Capacitor, no React Native, no mobile electron-builder target. A phone browser pointed at a LAN `:3000` is **not** a product surface — the product binds `127.0.0.1` only. A later phone/tablet surface would be a new pack, not this week.

## Sub-features

- `mobile-none` — no mobile build, no store package, no `--mobile` doctor flag.
- `mobile-lan-not-product` — opening Chat from a phone on the LAN is out of scope and must fail (loopback bind). Do not “fix” that by binding `0.0.0.0`.

## How to get to it (user POV)

- You cannot. There is no mobile install path. Use webdev (`http://127.0.0.1:3000`) or packaged desktop (ephemeral loopback ≠ 3000). Product copy and catalogs stay Toko Token; do not invent a TokenKu mobile app.

## Driving it with the DPSBuddy harness

Preconditions:

- Do not start a mobile toolchain. Do not add Capacitor, React Native, or Cordova.
- Doctor with no args is webdev. Doctor `--desktop` is packaged desktop. There is no `--mobile`.

- **Confirm docs only.** This file and [`docs/mobile.md`](../../../docs/mobile.md) exist. `apps/desktop/package.json` has `build.win` / `build.mac` / `build.linux` and no ios/android/capacitor target.
- **Do not** point a phone at `http://<lan-ip>:3000`. Drive `127.0.0.1` only.
- **Skip.** Record `mobile-none` as a documented skip, not a Cloud or Windows fail.

## Gotchas

- Binding `0.0.0.0` or advertising a LAN URL to “support phones” would violate the local-process rule (`127.0.0.1` only).
- Do not invent a mobile Electron target to make this file green.
- Future phone/tablet would be a later optional pack (same class as Students), not kernel schema and not this desktop pass.
- `pnpm desktop:dev` on :3000 is still webdev, not a phone preview.
