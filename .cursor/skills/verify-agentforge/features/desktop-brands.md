# Desktop brands

Public git and GitHub releases are **Agentforge** (Toko Token). Two local Windows flavors exist on the operator machine only: **Kemenkeu AI** and **AIHub Metranet**. Flavor folders under `apps/desktop/branding/kemenkeu/` and `apps/desktop/branding/metranet/` are gitignored. Do not upload those two installers.

The splash, exe, and Start menu can show the flavor while Chat still says Agentforge if the renderer never received `brand.json`. Packaged chrome must come from preload (`window.agentforge.brand` + `brandLogo`), not a host ping that can fire before IPC is ready or fail closed to Agentforge.

## Sub-features

- `desktop-brand-agentforge` is the public product: rail `product-brand` is Agentforge, Settings gateway is Toko Token, splash/exe match. Webdev on :3000 is always this flavor unless brand env is injected for a proof.
- `desktop-brand-kemenkeu` is the local NSIS `Kemenkeu AI Setup *.exe`. Rail `product-brand` is **Kemenkeu AI**, `product-logo` is the Kemenkeu mark, Settings/onboarding say **AIHub**, gateway lock is `https://aihub.metranet.co.id/v1`. userData is `%APPDATA%\Kemenkeu AI`.
- `desktop-brand-metranet` is the local NSIS `AIHub Metranet Setup *.exe`. Rail is **AIHub Metranet** plus the Metranet mark. Same AIHub gateway lock. userData is `%APPDATA%\AIHub Metranet`.
- `desktop-brand-preload` exposes `window.agentforge.brand` and a `data:image/png` `brandLogo` from `resources/brand` before React paints. Ping may confirm; it must not replace a flavor name with Agentforge.
- `desktop-brand-pack` is `AGENTFORGE_BRAND=kemenkeu|metranet|agentforge node apps/desktop/scripts/pack-brand.mjs` after the Vite renderer is staged. After a flavor pack the working tree restores to `branding/agentforge` (`--restore-public`).

## How to get to it (user POV)

- **Public / webdev:** Start menu Agentforge, or `pnpm dev` at `http://127.0.0.1:3000`. Rail says Agentforge.
- **Kemenkeu AI:** install the local Kemenkeu NSIS exe (not GitHub). Start menu → Kemenkeu AI.
- **AIHub Metranet:** install the local Metranet NSIS exe. Start menu → AIHub Metranet.
- Rebuild flavors only on Windows. Cloud must not `pnpm desktop:build`.

## Driving it with the Agentforge harness

Preconditions:

- Packaged proof is the **installed flavor window**, not Chrome on :3000.
- Doctor `--desktop` picks the newest `host-status.json` among Agentforge / Kemenkeu AI / AIHub Metranet. Record which folder it used.
- Do not paste keys. Do not `gh release` the flavor exes.
- Cloud can prove the webdev brand path by setting `AGENTFORGE_PRODUCT_NAME` / `AGENTFORGE_GATEWAY_NAME` / `AGENTFORGE_GATEWAY_URL` on `pnpm dev`, then asserting rail `product-brand` and ping JSON. That is not packaged proof.

- **Public webdev.** Doctor with no args. Rail `product-brand` is Agentforge. Settings privacy/onboarding copy names Toko Token.
- **Kemenkeu packaged.** Launch Kemenkeu AI. Splash name + logo match. After Chat or onboarding, rail `product-brand` is `Kemenkeu AI` and `product-logo` is visible. Settings says AIHub, not Toko Token, not Agentforge.
- **Metranet packaged.** Same for `AIHub Metranet`.
- **Working tree after pack.** `apps/desktop/splash` and `build/icon.ico` match `branding/agentforge`. Flavor logos stay only under the gitignored brand folders.
- **IDE proof.** Screenshot of the flavor Electron window with rail name + logo visible, plus doctor `--desktop` JSON (`productName`). Cloud: screenshot of webdev Chat with injected Kemenkeu env and rail `product-brand`.

## Gotchas

- Splash/exe/appId can be flavor while the renderer still says Agentforge if you packed without rebuilding `apps/web` or without `logo.png` in `resources/brand`. Rebuild web + `stage-renderer.mjs` + `pack-brand.mjs`.
- `pnpm desktop:dev` does not attach preload. That window follows webdev ping (Agentforge / Toko Token). Not flavor proof.
- Checking out `main` deletes gitignored flavor `icon.ico` / `logo.png`. Rebuild from `apps/desktop/branding/_raw/` with ImageMagick before packing.
- Wrap key service name is the product name (`Kemenkeu AI` / `AIHub Metranet` / `Agentforge`) plus account `wrap-key`. Uninstall of one flavor does not wipe another flavor’s `%APPDATA%`.
- Public GitHub releases stay Agentforge. Do not treat a flavor exe on disk as the GitHub artifact.
