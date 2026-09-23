# Mobile

There is **no mobile app**. No iOS or Android client ships with DPSBuddy.

- No App Store or Play Store listing.
- No Capacitor, React Native, or Cordova project in this repo.
- No electron-builder mobile target.

DPSBuddy is now a hosted web app, so a phone or tablet browser can in principle reach it. That is **untested and unsupported for now**: the layout has not been driven at phone width and nothing about it is proven. Use a desktop or laptop browser.

The Expo client under [`apps/mobile`](../apps/mobile/AGENTS.md) (Android first, iOS after) is paused; its rules live in that folder's `AGENTS.md`, and the plan is [`docs/internal/mobile-android-plan.md`](internal/mobile-android-plan.md). This Windows checkout cannot run Apple's Simulator.

Why this page changed: [`docs/internal/web-pivot-2026-09-18.md`](internal/web-pivot-2026-09-18.md). The desktop shell — the **Personal** product, now at `0.15.0`: [`apps/desktop/README.md`](../apps/desktop/README.md). Verification map: [`.cursor/skills/verify-agentforge/features/mobile.md`](../.cursor/skills/verify-agentforge/features/mobile.md).
