# Desktop brands

Public git and GitHub releases are **Nultron** (Toko Token). Two local Windows flavors exist on the operator machine only: **Kemenkeu AI** and **AIHub Metranet**. Flavor folders under `apps/desktop/branding/kemenkeu/` and `apps/desktop/branding/metranet/` are gitignored. Do not upload those two installers. The splash, exe, and Start menu can show the flavor while Chat still says Nultron if the renderer never received `brand.json`. Packaged chrome must come from preload (`window.agentforge.brand` + `brandLogo`), not a host ping that can fire before IPC is ready or fail closed to Nultron. Map: [`docs/internal/maps/desktop-pack-routes.md`](../../../../docs/internal/maps/desktop-pack-routes.md).

## Sub-features

- `desktop-brand-agentforge` is the public product: rail `product-brand` is Nultron, Settings gateway is Toko Token, splash/exe match. Webdev on :3000 is always this flavor unless brand env is injected for a proof.
- `desktop-brand-kemenkeu` is the local NSIS `Kemenkeu AI Setup *.exe`. Rail `product-brand` is **Kemenkeu AI**, `product-logo` is the Kemenkeu mark, Settings/onboarding say **AIHub**, gateway lock is `https://aihub.metranet.co.id/v1`. userData is `%APPDATA%\Kemenkeu AI`.
- `desktop-brand-metranet` is the local NSIS `AIHub Metranet Setup *.exe`. Rail is **AIHub Metranet** plus the Metranet mark. Same AIHub gateway lock. userData is `%APPDATA%\AIHub Metranet`.
- `desktop-brand-preload` exposes `window.agentforge.brand` and a `data:image/png` `brandLogo` from `resources/brand` before React paints. Ping may confirm; it must not replace a flavor name with Nultron. For the public flavor the rail does not draw that data URL: `usesBundledMark` (`apps/web/lib/product-brand.tsx`) sends it to `BrandMark`, the size-tuned Nultron mark bundled with the renderer (`<img data-testid="product-logo" srcset=… 1x, … 2x>` at 24 px). Only a flavor with its own name and logo draws `brandLogo`.
- `desktop-brand-logo` (2026-09-29) is the Nultron logo, the painted head in a blue rounded-square tile, in every file the app ships: `favicon.ico` + `favicon-32.png` + `favicon-180.png` (apple-touch) under `apps/web/public/brand/`, the rail mark `apps/web/components/brand-art/mark-{24,32,48,64}.png`, the display logo `logo.png` (256 px, one identical file in `apps/web/public/brand`, `apps/portal/assets`, `apps/desktop/{branding/agentforge,resources/brand,splash}`), `icon.ico` (16 to 256) in `branding/agentforge`, `build` and `splash`, `icon.icns` (`build.mac.icon`) in `branding/agentforge` and `build`, and the 1024 px sources `icon.png` (branding and build) and `mark.png`. The files come from Rizky's app-logo image through `apps/desktop/scripts/brand-icons.mjs` (the master is `apps/desktop/branding/agentforge/source/app-logo.webp`; `--out <dir> --check` compares every regenerated file with the repo's). Checks: `apps/web/lib/brand-assets.test.tsx` and `apps/desktop/brand-assets.test.cjs`.
- `desktop-brand-pack` is **Nultron first**, then the two local flavors. Same host/renderer; Kemenkeu / Metranet are chrome + `brand.json` only. Pack public with `pnpm desktop:build` (or `AGENTFORGE_BRAND=agentforge node apps/desktop/scripts/pack-brand.mjs` after stage). Prove that exe before `AGENTFORGE_BRAND=kemenkeu|metranet … pack-brand.mjs` or `pnpm desktop:build:all`. After a flavor pack the working tree restores to `branding/agentforge` (`--restore-public`). Missing flavor `icon.ico` / `logo.png` (gitignored) must be rebuilt from `branding/_raw/` before pack — do not invent logos.

## How to get to it (user POV)

- **Public / webdev:** Start menu Nultron, or `pnpm dev` at `http://127.0.0.1:3000`. Rail says Nultron.
- **Kemenkeu AI:** install the local Kemenkeu NSIS exe (not GitHub). Start menu → Kemenkeu AI.
- **AIHub Metranet:** install the local Metranet NSIS exe. Start menu → AIHub Metranet.
- Rebuild flavors only on Windows. Cloud must not `pnpm desktop:build`.

## Driving it with the Nultron harness

Preconditions:

- Packaged proof is the **installed flavor window**, not Chrome on :3000.
- Doctor `--desktop` picks the newest `host-status.json` among Nultron / Kemenkeu AI / AIHub Metranet. Record which folder it used.
- Do not paste keys. Do not `gh release` the flavor exes.
- Cloud can prove the webdev brand path by setting `AGENTFORGE_PRODUCT_NAME` / `AGENTFORGE_GATEWAY_NAME` / `AGENTFORGE_GATEWAY_URL` on `pnpm dev`, then asserting rail `product-brand` and ping JSON. That is not packaged proof.

- **Public webdev.** Doctor with no args. Rail `product-brand` is Nultron. Settings privacy/onboarding copy names Toko Token.
- **Kemenkeu packaged.** Launch Kemenkeu AI. Splash name + logo match. After Chat or onboarding, rail `product-brand` is `Kemenkeu AI` and `product-logo` is visible. Settings says AIHub, not Toko Token, not Nultron.
- **Metranet packaged.** Same for `AIHub Metranet`.
- **Working tree after pack.** `apps/desktop/splash`, `build/icon.ico`, `build/icon.icns` and `resources/brand/logo.png` match `branding/agentforge` (`node scripts/pack-brand.mjs --restore-public` puts them back; `node apps/desktop/brand-assets.test.cjs` reads them). Flavor logos stay only under the gitignored brand folders. To prove the restore without touching the tree, copy `scripts/`, `branding/`, `build/`, `splash/`, `resources/brand/` and `package.json` into a scratch `apps/desktop/`, delete or corrupt the build and splash files there, run `--restore-public` in the copy and `cmp` each file against the real one (2026-09-29: `build/icon.{ico,icns,png}`, `splash/icon.ico`, `splash/logo.png`, `resources/brand/{logo.png,brand.json}` byte-identical, `splash/index.html` equal apart from CRLF, a stale `splash/logo.svg` removed). It never starts electron-builder.
- **Logo on the public flavor.** In the expanded rail `product-logo` is a `span` around an `img` whose `currentSrc` is `mark-24` at 1x and `mark-48` at 2x; in the collapsed rail (375 px wide) `product-logo` is that `img` itself. Either way it is 24 x 24 CSS px and never a `data:` URL. With Playwright, `deviceScaleFactor: 2` proves the 2x candidate (`naturalWidth` reads 24 there because it is density-corrected; the file is 48 px). Splash shows `./logo.png` (256 px file) above `Nultron` at 88 x 88 CSS px (`.logo { max-height: 5.5rem }` overrides the `width="144"` attribute; open `apps/desktop/splash/index.html` as a `file://` page at 1x and 2x to see it). The tab shows the `favicon.ico` / `favicon-32.png` links in `index.html`; read them with `document.querySelectorAll('link[rel*=icon]')` and fetch each (200, `image/x-icon` or `image/png`).
- **IDE proof.** Screenshot of the flavor Electron window with rail name + logo visible, plus doctor `--desktop` JSON (`productName`). Cloud: screenshot of webdev Chat with injected Kemenkeu env and rail `product-brand`.

## Gotchas

- Splash/exe/appId can be flavor while the renderer still says Nultron if you packed without rebuilding `apps/web` or without `logo.png` in `resources/brand`. Rebuild web + `stage-renderer.mjs` + `pack-brand.mjs`.
- `pnpm desktop:dev` does not attach preload. That window follows webdev ping (Nultron / Toko Token). Not flavor proof.
- Checking out `main` deletes gitignored flavor `icon.ico` / `logo.png` (folders keep `brand.json` only). Official sources (do not invent marks): Kemenkeu Wikimedia [seal SVG](https://upload.wikimedia.org/wikipedia/commons/5/56/Seal_of_the_Ministry_of_Finance_of_the_Republic_of_Indonesia.svg) + [logo PNG](https://upload.wikimedia.org/wikipedia/commons/7/73/Logo_kementerian_keuangan_republik_indonesia.png); Metranet Brandfetch [logo SVG](https://cdn.brandfetch.io/ida6apCf2g/theme/light/logo.svg?c=1bxid64Mup7aczewSAYMX) + [icon JPEG](https://cdn.brandfetch.io/ida6apCf2g/w/400/h/400/theme/dark/icon.jpeg?c=1bxid64Mup7aczewSAYMX). Rebuild into `branding/_raw/` then ImageMagick (`C:\Program Files\ImageMagick-7.1.2-Q16-HDRI\magick.exe` on this desk): Kemenkeu PNG → `logo.png` + `icon.ico`; Metranet JPEG → splash `logo.png` + `icon.ico` (the Brandfetch light SVG can embed a mismatched raster — do not use it for chrome). Brandfetch CDN can 200 an HTML docs page if curl omits `Accept: image/*`.
- Wrap key service name is the product name (`Kemenkeu AI` / `AIHub Metranet` / `Nultron`) plus account `wrap-key`. Uninstall of one flavor does not wipe another flavor’s `%APPDATA%`.
- Public GitHub releases stay Nultron. Do not treat a flavor exe on disk as the GitHub artifact.
