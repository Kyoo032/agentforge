# nultron-3d

The offline 3D scene that renders the Nultron mascot. The app never runs it: it ships only the images this folder writes
(21 body stills, 21 head stills, 6 one-shot clips, 13 four-frame busy loops, 61 WebP files, about 2 MB) into
`apps/web/components/nultron/images/`. Read [`docs/internal/maps/mascot-and-brand.md`](../../docs/internal/maps/mascot-and-brand.md)
first for how the app draws them.

This folder is **outside the pnpm workspace** on purpose (`pnpm-workspace.yaml` lists only `apps/*` and `packages/*`): it has its
own `package.json`, an npm `package-lock.json`, and one dependency, `three` pinned to exactly `0.186.1`. Nothing in the app,
the installer or the Enterprise image imports it. The Enterprise image build context excludes `tools/` (both
`webapp-deploy/.dockerignore` files).

The logo is a different pipeline and is not here: see "Logo" at the end.

## Re-render the app images

Needs Node 22 or newer, and the repo's Electron (`npx pnpm@9.15.9 install` once at the repo root puts it under
`apps/desktop/node_modules`; `lib/electron.mjs` finds it from the repo root, no path is written anywhere). It is proven on
Windows with a D3D11 GPU only; on another system Chromium picks its own WebGL backend and nothing here has been driven there.

```
cd tools/nultron-3d
npm ci
node render-all.mjs --out out            # about 30 s; writes out/full, head, clips, loops, brand, manifest.json
node verify-out.mjs out                  # every manifest entry exists, strips have the advertised size and alpha, bytes add up
node sync-images.mjs out --check         # what would change in the app, and the app's own contract; writes nothing
node sync-images.mjs out                 # copies what differs into apps/web/components/nultron/images/
```

`sync-images.mjs` reads the app's contract from its source (`mascot-states.ts`, `nx-image-manifest.ts`, `globals.css`) and
refuses a set the app's `lib/nultron-images.test.tsx` would fail: a state the app does not know, a clip outside 600 to 1200 ms,
a loop that is not exactly four frames, a missing file, a wrong pixel size, no alpha, a wrong `bytes` total. It leaves
byte-identical files alone, deletes files the new manifest no longer names, and never touches `images/README.md`. After a real
sync, run the app's check:

```
npx pnpm@9.15.9 --filter @agentforge/web exec vitest run lib/nultron-images.test.tsx lib/nultron-motion.test.ts
```

`out/`, `work/` and `node_modules/` are git-ignored. The default `--out` is `tools/nultron-3d/out`.

### Is a re-render the same picture?

Close, not bit-identical. The images in the app were rendered before this folder existed; a re-render from here differs from
them by a mean of about 0.9 of 255 per channel over the character's pixels, at most 0.9% of those pixels by more than 16
(`node compare-images.mjs <dirA> <dirB>` prints it per file), with the alpha channel within 1 of 255. Two renders of the *unchanged*
scene differ from each other by the same amount, because three's ambient-occlusion pass builds its denoise noise from
`Math.random()`. `scene-main.js` now seeds that noise (`AO_NOISE_SEED`), which cuts the run-to-run difference to a mean of about
0.16 and makes most files (about 50 of 61) byte-identical between runs; the rest still move a little (a GPU-side effect on
states with translucent effects, not traced). So: do not expect `sync-images.mjs` to report "identical" after a re-render, and
do not re-sync just because it differs. Sync when you changed the scene on purpose.

## What is here

| path | what |
|---|---|
| `CONTRACT.md` | the scene graph (`nx-*` node names), units, palette and the modeller's changelog: read before touching the model |
| `layout.js` | every measurement of the character, taken off the reference sheet; `dims.json` is generated from it by `node gen-dims.mjs` |
| `geo.js`, `materials.js`, `head.js`, `body.js`, `hands.js`, `character.js` | the model: `buildNultron()` returns the `nx-root` graph |
| `rig.js`, `poses.json` | `applyPose(root, state, ...)`; `poses.json` is generated, never hand-edited |
| `poses/src/states.mjs`, `poses/build-poses.mjs` | where poses are authored (world-space hand targets, solved against the real arm lengths) |
| `poses/tools/`, `poses/test/` | IK, clearance and forward-kinematics checks; the rig tests |
| `props.js`, `props/*.js` | every held, worn and floating prop and the effects (`props/NOTES.md` explains the conventions) |
| `stage.js`, `finish-pass.js`, `scene-main.js`, `scene.html` | studio light, ground shadow, tone mapping and downsample, the page the renderer loads |
| `render.mjs` | one image or a `--batch jobs.json` (`look-jobs.json` is the hero set) |
| `render-all.mjs` | the shipping set: measures every pose, fixes one camera for all of them, writes the manifest |
| `verify-out.mjs`, `sync-images.mjs`, `compare-images.mjs`, `make-contact.mjs`, `optimize-png.mjs` | check, install, compare, review sheet, lossless PNG re-encode |
| `lib/` | `electron.mjs` (paths and the re-launch under Electron), `png.mjs`, `webp.mjs`, `app-contract.mjs`, `manifest-check.mjs` |
| `test/` | tests for the sync and the contract check |

Every entry point that renders starts under plain node and re-runs itself under the repo's Electron (offscreen WebGL, a hidden
window). Two traps from the render harness: an ESM entry must not `await app.whenReady()` at top level (it deadlocks), and
`ELECTRON_RUN_AS_NODE` must be unset (the launcher does). Scratch output (previews, logs) goes to `work/`.

## Changing the character

Always end with the render steps above. Sync only when the result is what you meant.

- **A colour.** `materials.js` (the character) and `PALETTE` in `props/mats.js` (props); record it in the palette line of
  `CONTRACT.md`.
- **A proportion.** Edit `layout.js`, then `node gen-dims.mjs` (props size themselves from `dims.json`), then
  `node poses/build-poses.mjs` (re-solves every arm; it prints a line per arm and flags a target out of reach), then
  `node poses/tools/clearance.mjs --all` (how deep hands and props sink into the head and body), then the tests.
- **A pose or a clip or a loop.** Edit `poses/src/states.mjs` (`clip` and `loop` are frame lists there), run
  `node poses/build-poses.mjs`, then `node --test "poses/test/*.test.mjs"` (all 21 states, clips end on the still, loops are four
  frames and wrap). Look at it: `node poses/preview.mjs --out work/poses/sheet.png --query "model=real&view=front&states=wave,love"`
  (query options are in the header of `poses/preview.mjs`), or `bash poses/tools/render-motion.sh` for every strip.
- **A prop.** Edit or add it under `props/`, register it in `props.js`, reference it by name from the state in
  `poses/src/states.mjs`. Preview on a sheet:
  `node props/harness/run.mjs --page props/harness/sheet.html --out work/props-sheet.png --query "group=held&bg=light"`.
- **A new state.** The app comes first: `MASCOT_STATES` and `STATE_MOTION` in `apps/web/lib/mascot-states.ts` and the label in
  both `common` locale catalogs. Then the state in `poses/src/states.mjs`; a busy state also goes in `LOOP_STATES` in
  `render-all.mjs`. `sync-images.mjs` will refuse the set until both sides agree.

## The byte budget

The app bundles every file in `images/` in every build, so the set is kept to about 2 MB: today **1,993,520 bytes** in 61 files
(`full` 462 KB, `head` 217 KB, `clips` 755 KB, `loops` 558 KB). `manifest.bytes` must equal the sum exactly (`verify-out.mjs`
and `sync-images.mjs` check it; the app's test allows 10%). There is no hard cap in code, so the budget is a rule you hold:
before syncing, compare `verify-out.mjs`'s `webp assets` line with the number above. The levers, in the order to try them:
`--quality` (default 90), `--loop-size` (default 320; 256 trims the loops most), fewer clip frames (12 fps and at most 1.2 s, so
14 frames is the ceiling), and the supersampling in `render-all.mjs`. Loops stay exactly four frames. A new state costs about
30 KB for its two stills, about 40 KB more if it loops and 100 to 150 KB more if it has a clip.

## Tests

```
node --test "poses/test/*.test.mjs" "test/*.test.mjs"     # about 40 s (the rig tests build the model many times)
node check-tree.mjs                                       # the scene graph smoke test
```

The repo's Biome lints this folder with the rest (`npx pnpm@9.15.9 lint`; the formatter is off there). Keep it clean.

## Optional extras (Python 3 and Pillow; never needed for the app's images)

`review/make-compare.py` and `review/crop-ref.py` build a side-by-side of the renders and the reference sheet (they need
`node render.mjs --batch look-jobs.json` first). `poses/tools/compose-sheet.py` and `compose-loops.py` stitch preview frames
into labelled sheets. `make-contact.mjs` and `optimize-png.mjs` replaced the two other Python helpers and need only node and
the repo's Electron.

## Logo

The app logo (rail mark, favicon, Windows and macOS icons, the display `logo.png`) is Rizky's painted head in a blue tile. It is
not a 3D render and does not come from here. Its master is `apps/desktop/branding/agentforge/source/app-logo.webp` (1600 px)
and `apps/desktop/scripts/brand-icons.mjs` regenerates every file from it; see "Regenerating" in the map page above.
