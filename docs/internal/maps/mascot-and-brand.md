# Mascot and brand: the Nultron character

Last verified: 2026-09-29 at aaf249d (uncommitted working tree on top of it)

## Overview

The desk has one character, Nultron, shown wherever the product wants a face: the empty Chat hero, a chip beside a running job or a live reply, an empty studio, the onboarding hero, the first-run installer panel and the updates panel. It is **a set of pre-rendered images**: an offline 3D scene (glossy clay, one fixed camera, transparent background) renders one still per state, a short one-shot clip for six states and a four-frame loop for thirteen working states; the app ships only those files (about 2 MB of WebP) and never a 3D engine. The scene's source is `tools/nultron-3d`, outside the pnpm workspace (see "Regenerating"). **What the character does is data** (21 states, one motion each, in `lib/mascot-states.ts`); which picture it shows is a file per state named by a manifest. **What a page loads is decided by its mount points**, not by the mascot: the Chat's first load fetches 3 of the 61 files (66 KB), and a strip is fetched when a pointer, a focus or a started job says it is about to play (section 2, "What loads, and when").

The product **logo** is a different thing and is on this page too (section 6): Rizky's painted Nultron head in a blue rounded-square tile, in the rail, the favicon, the splash, the Windows and macOS icons. The 3D head renders are the in-app mascot and are never the logo.

History that still matters: the character was first drawn by a flat vector rig (an SVG converted to React, poses toggled by data attributes) and a flat brand kit. The owner rejected the flat look on 2026-09-29 ("more 3D and realistic, following the reference image"); the 3D renders were approved the same day, and the SVG rig, its generator and the flat brand kit were deleted from the tree. See `Why`.

## How it works

### 1. One state table

`MASCOT_STATES` (`apps/web/lib/mascot-states.ts:8`) names the 21 states; `STATE_MOTION` (`:66`) says how each moves. The picture for a state is not in this file: it comes from `manifest.json`.

| motion | states | what it means |
|---|---|---|
| `still` | idle, sleep | no animation at all |
| `once` | wave, celebrating, error, surprised, love, lets-go | one finite clip of 600-1200 ms when the state is entered, ending on the still |
| `loop-busy` | thinking, writing, answering, searching, calculating, charting, reviewing, listening, painting, filming, editing, presenting, charging | loops, stepped, **only while `data-busy` is set**; without it the state holds its still |

`MascotMotion` (`mascot-states.ts:64`) is the performance contract: the packaged Windows app has no GPU, so one running CSS loop costs a full software-composited frame sixty times a second. `isMascotBusy` (`:151`) is `placement === "beside"` and `loop-busy`; the component sets `data-busy` only when the caller also says a job is running (`busy`), because a dropped job stream leaves a working pose behind. `mascotStateFor` (`:174`) picks a job's state from its mode and phase, `MASCOT_MODE_HOME` is the state of an empty desk.

Four states are new on 2026-09-29: `surprised`, `love`, `charging`, `lets-go` (labels `common.mascot.*`, both locales).

### 2. The component

`NultronMascot` (`apps/web/components/nultron/nultron-mascot.tsx:63`) renders one root `<span class="chat-mascot nx-root">` carrying `data-testid="chat-mascot"`, `data-mascot="nultron"`, `data-state`, `data-motion`, `data-variant` (head | full), `data-clip`, `data-loop`, `data-placement`, `data-busy`, `data-mode`, and inside it `NxImageRig`. The root class and `data-busy` are what the desk's ambient pause and reduced-motion rules name (`app/globals.css:2011`, `:2019`), so the root class stays.

- **Sizes.** `size` px below 64 draws the head picture, from 64 the body (`variantForSize`, `:27`; `NX_FULL_MIN`, `:18`). Default: `beside` a job 40 px, `empty` desk 72 px. `variant` picks the picture when the stylesheet sizes the box (the hero). Heads at 24 px cannot tell error from sleep: keep chips at 32 px or more.
- **`decorative`** makes the mascot silent to a screen reader (`aria-hidden`, no role, name or tooltip). Used where text next to it already says the same: the installer status region, the updates panel, job progress, the chat error line, the busy chip beside "Generating…" on Documents, Images, Music, Videos and Presentations (and beside Edit's export line), and the hero (the button carries its own name). The live Chat turn's mascot is not decorative today. Left off where the character stands alone: empty desks, onboarding.
- **Picture.** `NxImageRig` (`nx-image-rig.tsx:56`) draws the still (`full/<state>` or `head/<state>`) and, on the body only, the clip strip for a `once` state (`hasClip`, `nx-picture.ts:20`) or, **only while the mascot is `busy`**, the loop strip for a working state (`hasLoop`, `:25`): an idle body never mounts its loop, so it never fetches it (an empty desk's home pose is a working state that is never busy). Which files draw a state is `pictureUrls` (`nx-picture.ts:34`), shared by the rig and the warm-up. Each state is one keyed `NxArt` (`nx-image-rig.tsx:77`), because a CSS animation restarts only when its name changes or its element is new and two clip states share their animation names.
- **Never an empty box** (2026-09-29). Two rules, driven with every image request delayed 300 ms and with the HTTP cache off through CDP `Network.setCacheDisabled`: (1) a strip animates only under `.nx-art[data-sheet="ready"]`, set once the strip is loaded and decoded (`whenPaintable`, `nx-image-rig.tsx:18`, `img.decode()`) and the art's own still is painted, so until then the still stays and the clip starts late instead of playing over nothing (`nultron.css:135-163`); (2) the art of the state the desk was showing stays mounted as `.nx-held`, under the new art, until the new still can be painted (`NxImageRig`, `:56-75`; `nultron.css:50`). It is the same element and not a copy of its URL: with the cache off Chromium requests a URL again for every new `<img>`, so a second `<img>` of the old still is itself an empty box until it is refetched (17 blank frames, about 266 ms, in the first version's CDP drive; 0 in the final one). The cost of rule (1) is a few frames: with a warm cache a hover reaches the wave clip in about 120 ms and a tap the cheer in about 65 ms on webdev, where the ungated version took about 115 and 35 ms (medians of 6 runs each under other agents' load, so read them to within 20 ms). With the cache off and a 300 ms link the clip starts after the fetch (about 420 ms) and the still holds meanwhile.
- **What loads, and when** (2026-09-29; it replaced `warmStrips`, which fetched all 19 strips, 1.31 MB in 20 requests, on every page load that mounted a mascot, and none of the stills). `nx-warm.ts` fetches what a mount point says it can reach next, through `Image` objects it keeps (so the browser's in-memory copy serves a later `<img>` of the same URL), and never decodes them: a decoded strip is `frames x 320 x 320 x 4` bytes (5 MB for a clip, 1.6 MB for a loop, 48 MB for all 19), and painting decodes it. Two moves: `warmMascotAtIdle` (`requestIdleCallback` with a 2 s timeout, a 250 ms timer where there is none) for stills, and `warmMascot` at once for strips when an event makes them likely. A head has no strip, so `pictureUrls` gives a head its still only. Nothing warms at import or at mount except what a mount point asks for through the mascot's `next` prop (an effect, `nultron-mascot.tsx:83`).

  | mount point | stills, at idle (`next`) | strips, on an event |
  |---|---|---|
  | Chat hero | `wave`, `celebrating`, body (`HERO_NEXT`, `mascot-triggers.ts:96`) | both clips (290 KB) on the first `pointerenter`, `pointerdown` or focus anywhere on the hero section, which comes before the orb is reached (`chat-hero.tsx:55-66`) |
  | `MascotSlot` (`slotNextStates`, `mascot-triggers.ts:112`) | empty desk: home pose and `sleep`; chip beside a job: home pose, every pose a phase calls for, `celebrating`, `error` (heads, about 1 KB each) | none; an empty desk's own `wave` strip is fetched by its mount, and its still shows until the strip is ready |
  | live Chat turn | `lets-go`, `thinking`, `answering`, `error` (`LIVE_TURN_NEXT`, heads) | none: a 40 px chip is a head |
  | installer and updates panels | `celebrating`, `error`; `surprised`, `error` (heads) | none |
  | onboarding hero | `idle`, `love` (`ONBOARDING_NEXT`) | the `love` clip when the key step opens (`onboarding-screen.tsx:104-110`), one step ahead |

  Measured on webdev, a cold load, `Image` requests for `components/nultron/images`: `/chat` **3 requests, 66,222 bytes** (was 20, 1,338,036), `/market` **4, 207,630** (was 22, 1,367,045; the `wave` clip is the one strip a mount needs). Renderer memory in a software-composited Electron 35 window (7 loads each, median): the old warm added 1.6 to 6.6 MB of private memory (median 2.3) to a renderer that had already settled, which is the 1.3 MB of encoded files and their bookkeeping; it never decoded a strip, so the "tens of MB" of decoded strips (a forced `decode()` of all 19 added 32 MB of working set) was never held by the warm itself, and it is what a strip costs once it is painted. A `warmMascot` after a hover of the hero costs the two clips' 290 KB and, once they play, their decoded frames.

### 3. The manifest and the files

`apps/web/components/nultron/images/manifest.json` (the contract with the 3D pipeline):

```
{ "version": 1,
  "full":  { "size": 512, "states": { "<state>": "full/<state>.webp", ... } },
  "head":  { "size": 256, "states": { ... } },
  "clips": { "<state>": { "src": "clips/<state>.webp", "frames": 10-14, "fps": 12, "size": 320 } },   // six once states
  "loops": { "<state>": { "src": "loops/<state>.webp", "frames": 4, "fps": 3|4|6, "size": 320 } },   // thirteen working states
  "bytes": 1993520 }
```

- The manifest is imported (`nx-image-manifest.ts:32`, typed and bundled), not fetched. `clipMs` / `clipBeats` (`:57`, `:62`) and `loopBeats` (`:67`) turn `frames / fps` into beats of `--motion-4` (`NX_BEAT_MS` 320), so every duration still comes from the desk's motion scale. A loop runs at the fps recorded for **that loop**; it is exactly 4 frames because `--ease-busy` is `steps(4)`.
- Files resolve through `import.meta.glob` (`nx-image-urls.ts:8`), not a `/nultron/...` path: the desktop shell loads the renderer as a `file://` document where an absolute path points at the disk's root, and the bundler puts a content hash in each name so a replaced render is never served stale. A production build turns each one into `new URL("<name>-<hash>.webp", import.meta.url).href`, so it resolves against the script, not the page (read from a `vite build` on 2026-09-29: all 61 files in `assets/`). The files therefore live in `components/nultron/images/`, not `public/`. `images/README.md` is the drop-in guide for the 3D team.
- The strips are static sprite sheets, moved with `transform` and `steps()`; nothing is an animated WebP.
- **Framing.** One fixed camera: the body is about 77% of the frame height in every `full/` image (74% for `listening`, 79% for `lets-go`, 83% for `charging`) and every boot sits on the same line, 86.7% of the frame, except `charging`, which stands on 93% (measured from the alpha channel of each file, 2026-09-29). A state change never makes the character jump, and nothing is re-cropped per state. The hero box therefore gives back 8% of its side at each end (`margin-block`, `app/globals.css:1828`; the rule opens at `:1824`): only transparent pixels sit outside the layout.

### 4. Motion in CSS

`components/nultron/nultron.css` holds the box, the hero drift, the strips and the fallbacks. Keyframes are named `nxm-*` (the desk already has `nx-rise`, `nx-pop`, `nx-wiggle` and `nx-bob`) and animate `transform`, `opacity` and the individual `rotate` / `translate` / `scale` properties. No filters.

- **Clip** (`once`, body with a strip): under `.nx-art[data-sheet]` (the strip is loaded and decoded), `.nx-strip` shows and `.nx-still` hides for `frames / fps`, the strip's image steps with `steps(frames, jump-none)` (`--nx-clip-ease`, `nultron.css:34`; rules at `:140-150`), then the still is back. The last frame equals the still.
- **Loop** (`loop-busy`, body with a loop, only under `[data-busy][data-loop]` and `.nx-art[data-sheet]`): the loop strip replaces the still and steps through its 4 frames, `steps(4)` with `--ease-busy` (`:153-163`).
- **Held art** (`.nx-held`, `:50`): the previous state's art, kept under the new one until its still can be painted. The rules above key on the root's attributes, which are the new state's, so the held still cancels its own animation (`animation-name: none !important`) and shows at opacity 1; it has no strip and no `data-sheet`.
- **Fallback** for a state with no strip, or a head (under 64 px, which has neither): a small percent-based transform on the still (hop, tilt, throb, lean; bob, nod, swell while busy), guarded by `:not([data-clip])` / `:not([data-loop])` (`:250` on). Every fallback clip starts and ends on the identity.
- **Hero drift**: the whole picture moves a few pixels with `--px` / `--py` (written on the hero by `attachHeroMotion`), transform only (`:46-60`). The old eyes-follow-the-pointer is gone with the SVG rig: there are no eyes to move.
- **Reduced motion** removes every animation and transition and keeps the picture (`.chat-mascot, .chat-mascot * { animation: none }` in `nultron.css` and in the global block at `app/globals.css:2046`). A busy body would otherwise show frame 0 of its loop strip in place of the still, so the same block puts the still back under `[data-busy][data-loop]` (`nultron.css:311-330`, with `!important` because the swap rules above wait for `.nx-art[data-sheet]` and are more specific); driven on 2026-09-29 with real `reducedMotion` emulation: hero tap, a `once` desk state and a forced-busy `writing` body all showed the still and ran no animation.

Every loop is under `[data-busy]`, so the desk's ambient pause (`app/globals.css:2011`, everything not busy) and its hidden-window pause (`:2019`, busy ones too) reach it through `.chat-mascot`. `lib/nultron-motion.test.ts` holds the contract; `lib/motion-tokens.test.ts` reads `nultron.css` as well for its infinite-loop and stepped-loop checks.

### 5. Who mounts it, and which state

| where | state source | sized |
|---|---|---|
| Chat hero, `components/chat-hero.tsx:70` | hero mood (`lib/hero-mood.ts`): idle, wave on hover, celebrating on tap | `variant="full"`, `--orb` (`app/globals.css:1824`): 60-68 px at window heights of 860 and under, 72-96 px to 900, 60-68 px at 901-960 (the 900 block narrows the hero's padding and a window just over it has less room), 72-96 px to 1040, up to 160 px above (measured at 1280 wide: 68 px at 760-860, 96 at 900, 68 at 901-960, 96 at 961-1040, 160 from 1041) |
| live assistant turn, `components/chat-turn.tsx:86` | `liveTurnMascot` (`lib/mascot-triggers.ts:72`): error, else `lets-go` for the first 900 ms of a thread's first turn (`useHoldOnMount`, `chat-turn.tsx:51`; `firstTurn` from `chat-session.tsx`), else answering or thinking | 40 px head, busy while `live.running` |
| Chat error line, `components/chat-session.tsx` | `error`, decorative | 40 px |
| every job and studio (`MascotSlot`, `components/mascot-slot.tsx:39`) | `mascotStateFor` from mode and job phase; wave for 1.4 s on an empty desk (`WAVE_MS`), sleep after 45 s (`SLEEP_MS`); `?mascot=<state>&mascotMode=<mode>` previews a state | beside a job 40 px, on an empty desk 72 px; job progress passes `decorative` |
| onboarding hero, `components/onboarding-screen.tsx:53` (`StepHero`) | `onboardingMascot`: wave, idle while the key goes in, love on the last step | 96 px |
| first-run installer panel, `components/component-setup.tsx:79` | `componentSetupMascot`: charging while it runs (busy), then celebrating or error | 40 px, decorative |
| rail updates panel, `components/app-updates.tsx:173` | `updateMascot`: charging while it downloads (busy), surprised once it is ready | 40 px, decorative |

Empty desks carry the mascot in `ModeIllustration` (Meeting, Market, Finance, Edit, Education) and in Legal and Knowledge. Documents, Images, Music, Videos and Presentations show it only while a job runs, and there it is `decorative` (the "Generating…" line beside it says what it shows; Edit's export line the same). `lib/mascot-triggers.ts` maps each moment of the app to a state.

Two placement rules from the 2026-09-29 sweep. **One character per empty desk:** Meeting's recordings list used to draw it and say "Create one, add the recording…" as well as the main pane beside it (stacked on a phone), so an empty Meeting showed both twice; the list now says only "No meetings yet." (`meeting-studio.tsx:711`) and the main pane keeps the character and the sentence (`:904`), the place the minutes will appear (`lib/meeting-empty-desk.test.tsx`). **Onboarding's shapes stay in the character's bands:** the hero's decorative shapes (`hero` layout, `floating-shapes.tsx:26-43`) all sit above the headline and outside the 96 px box, two on a phone, four from a 26rem-wide hero and five from 44rem (`.onboarding-hero`, `app/globals.css:1915-1935`, the hero is its own unnamed size container); the old seven, scattered by percent, lay on the intro text and touched the character at 375 and 320 px (`lib/onboarding-hero-shapes.test.tsx`).

### 6. The logo

Owner ruling, 2026-09-29: the logo is Rizky's own painted head in a blue tile. Its master is `apps/desktop/branding/agentforge/source/app-logo.webp` (1600 px, no alpha, white corners; the same file is kept with the review record in `docs/internal/brand/nultron/reference/`). `apps/desktop/scripts/brand-icons.mjs` cuts the tile out of the corners along its measured edge (`brand-logo-cut.mjs`) and writes every file below; the command is under "Regenerating". Every file is in the tree, and none is drawn from the mascot renders.

| surface | file | how it is used |
|---|---|---|
| tab icon, `apps/web/index.html:6-8` | `apps/web/public/brand/favicon.ico` (16, 32, 48), `favicon-32.png`, `favicon-180.png` (apple-touch); no SVG | three `<link>` tags; the hosted server rewrites `./brand/...` to `/brand/...` (`rootRelativeAssets`) |
| rail header and collapsed rail, `components/app-rail.tsx` `BrandTile`, `components/workspace-switcher.tsx` | `apps/web/components/brand-art/mark-{24,32,48,64}.png` | `BrandMark` (`components/brand-mark.tsx`): `<img srcset>` at 24 px (24 file at 1x, 48 at 2x); 32 px for the sign-in screen (32 and 64). Imported, so the bundler hashes them and the URL resolves in the packaged `file://` renderer |
| who draws it | `usesBundledMark` (`lib/product-brand.tsx`) | true for the default brand on the web (`logoSrc === WEB_LOGO_SRC`) and on the desktop (`productName === DEFAULT_PRODUCT_NAME`); a flavor with its own name and logo (`kemenkeu`, `metranet`) draws its `logoSrc` data URL instead |
| display logo | `logo.png`, 256 px, 110 KB, one identical file in `apps/web/public/brand`, `apps/portal/assets`, `apps/desktop/branding/agentforge`, `apps/desktop/resources/brand`, `apps/desktop/splash` | the splash page (88 CSS px: the `<img>` says 144, `.logo { max-height: 5.5rem }` wins; measured in Chromium at 1x and 2x), the portal page shell (24 px, `apps/portal/src/views/layout.ts:72`) and the preload's `brandLogo` data URL. Only a flavor draws that data URL; the public brand reads and inlines it at every launch and never shows it. Measured in an Electron preload (`brand-read.cjs:46` `loadBrandLogo`, 15 launches): 0.7 to 0.9 ms to read and encode 146,442 characters (worst 2.2 ms), 0.1 ms to hand it across `contextBridge`, so the 110 KB is not a launch cost worth shrinking; `brand-assets.test.cjs` still caps it at 200 KB. The portal serves it with a year-long cache. At 24 CSS px the 256 px file loses the face at 1x (the tuned `mark-24` keeps it), which the portal accepts because it serves exactly one file |
| Windows | `icon.ico` (16, 24, 32, 48, 64, 128 as DIB, 256 as PNG) in `branding/agentforge`, `build`, `splash` | electron-builder `win.icon`; the splash window icon (`main.cjs`) |
| macOS | `icon.icns` (icp4-icp6, ic07-ic10) in `branding/agentforge` and `build` | `build.mac.icon` in `apps/desktop/package.json`; `scripts/pack-brand.mjs` copies it (and removes it for a flavor that ships none) |
| sources | `icon.png` (1024, branding and build), `mark.png` (1024, tile at 64% on a transparent canvas) | Linux and fallback icon source; `apps/desktop/logo.png` (160 px) is gitignored and unused |

The 24 and 32 px marks are size-tuned (a tighter crop so the face still reads); 48 and up show the whole artwork. Every mark's tile spans 100% of its canvas with transparent corners (measured from the alpha channel, 2026-09-29; `favicon-180.png` is opaque, the apple-touch rule). The macOS icon sits on Apple's grid (the 1024 px entry's tile is 824 px, 80.5%, with a soft shadow round it; entries from 128 px up), the Windows one and `icon.png` are edge to edge, and `mark.png` holds the tile at 64% of a transparent 1024 px canvas.

## Where things live

| file | role |
|---|---|
| `apps/web/lib/mascot-states.ts` | states, `STATE_MOTION`, `isMascotBusy`, `mascotStateFor`, phase map |
| `apps/web/lib/mascot-triggers.ts`, `use-hold-on-mount.ts` | which state each moment of the app calls for |
| `apps/web/components/nultron/nultron-mascot.tsx` | the component, sizes, `decorative` |
| `apps/web/components/nultron/nx-image-rig.tsx` | still, clip and loop markup; the held art and the `data-sheet` readiness gate |
| `apps/web/components/nultron/nx-picture.ts` | `hasStill` / `hasClip` / `hasLoop` and `pictureUrls`: which files draw a state |
| `apps/web/components/nultron/nx-warm.ts` | `warmMascot`, `warmMascotAtIdle`, `whenIdle`: fetch what a mount point can reach next; keeps the `Image` objects |
| `apps/web/components/nultron/nx-image-manifest.ts`, `nx-image-urls.ts` | the typed manifest and the URL resolution |
| `apps/web/components/nultron/images/` | `manifest.json` and the WebP files, `README.md` |
| `apps/web/components/nultron/nultron.css` | box, hero drift, strips, fallbacks, reduced motion |
| `apps/web/components/mascot-slot.tsx` | mode-aware mount, wave/sleep timers, `?mascot=` preview |
| `apps/web/components/brand-mark.tsx`, `brand-art/` | the logo mark and its four PNGs |
| `apps/web/lib/product-brand.tsx` | `WEB_LOGO_SRC`, `usesBundledMark` |
| `apps/web/public/brand/` | favicon set and the 256 px `logo.png` |
| `apps/desktop/branding/agentforge/`, `build/`, `splash/`, `resources/brand/` | icon and logo files for the packaged app; `scripts/pack-brand.mjs` restores them |
| `apps/desktop/branding/agentforge/source/app-logo.webp` | the logo master (1600 px); nothing ships it (`branding/` is in no installer and in the Enterprise image's ignore list) |
| `apps/desktop/scripts/brand-icons.mjs`, `brand-logo-cut.mjs` (+ `.test.mjs`) | master to every logo file: decode, cut, ladder, `.ico`, `.icns`, favicons, marks; `--check` and `--apply` against the repo paths in `REPLACEMENTS` |
| `tools/nultron-3d/` | the 3D scene, rig, props and renderer that make `components/nultron/images/`; own `package.json` (three 0.186.1) and lockfile, git-ignored `node_modules`, `out`, `work` |

## Regenerating

Both sources are in the repo. Neither needs Python, and neither needs anything installed by hand beyond `pnpm install` (for Electron) and, for the mascot, one `npm ci`. Read `tools/nultron-3d/README.md` before changing the character.

**The mascot images.** From the repo root (Windows; about 30 s for the render):

```
cd tools/nultron-3d
npm ci
node render-all.mjs --out <dir>       # full/, head/, clips/, loops/, brand/, manifest.json
node verify-out.mjs <dir>             # files present, strip sizes and alpha as advertised, bytes add up
node sync-images.mjs <dir> --check    # what would change in components/nultron/images/, and the app's own contract
node sync-images.mjs <dir>            # copy what differs, delete what the manifest no longer names
node --test "poses/test/*.test.mjs" "test/*.test.mjs"
```

A re-render is close to the shipped images, not identical: mean 0.9 of 255 per channel over the character's pixels, at most 0.9% of those pixels off by more than 16, alpha within 1 (`node compare-images.mjs <dirA> <dirB>`). Two renders of the same scene differ by the same amount because the ambient-occlusion pass draws its noise from `Math.random()`; `scene-main.js` seeds it now, which makes about 50 of the 61 files byte-identical between runs. `poses.json` and `dims.json` do regenerate byte-identical (`node poses/build-poses.mjs`, `node gen-dims.mjs`). Sync only when the scene changed on purpose.

**The logo files.**

```
node apps/desktop/scripts/brand-icons.mjs --out <dir> --check    # regenerate into <dir>; exit 1 if a repo file differs
node apps/desktop/scripts/brand-icons.mjs --out <dir> --apply    # the same, then write the differing files over the repo's
node --test apps/desktop/scripts/brand-icons.test.mjs apps/desktop/scripts/brand-logo-cut.test.mjs
```

`--png-src` defaults to `apps/desktop/branding/agentforge/source`. With only `app-logo.webp` there, the script decodes it in Electron (byte-identical to a Pillow decode), cuts the tile out of the white corners (`brand-logo-cut.mjs`; written to `<dir>/source/app-logo-cut.png`) and derives everything from that. It then compares the 21 repo paths in `REPLACEMENTS` with the kit's files. On 2026-09-29 the run from the repo's own master gave 21 of 21 byte-identical: the five 256 px `logo.png` files are `mark/mark-256.png`, the two 1024 px `icon.png` files are `replace/logo-1024.png`, `mark.png` is `replace/mark-1024.png`, the four `brand-art/mark-*.png` are `mark/mark-{24,32,48,64}.png`, `favicon.ico`, `favicon-32.png`, `favicon-180.png`, the three `icon.ico` and two `icon.icns` are the kit files of the same name, and the untracked `apps/desktop/logo.png` (160 px) is `replace/logo-160.png`.

## Gotchas

- **`.chat-mascot` and `data-busy` are a contract with `app/globals.css`.** The ambient pause, the hero's off-screen pause and the reduced-motion block name them. A wrapper class in place of the root, or a loop outside `[data-busy]`, silently runs on an idle desk (`lib/motion-tokens.test.ts` and `lib/nultron-motion.test.ts` fail).
- **`:is(a, b)` in a loop rule breaks the loop audits**, which split selectors on commas. Write two selectors.
- **A head chip has no clip and no loop**, only the small transform motion. Working chips nod, bob or swell; the richer strips are on the body (64 px and up).
- **The hero's height budget is real.** At 1280 x 800 the empty Chat has almost no room. Measure `[data-testid="message-list"]` `scrollHeight - clientHeight`: 0 at 800, 860, 900, 940, 960 and from 961 up; 14 px at 780, 34 at 760 and 21 at 901 (the 900px block's padding step, older than the mascot; measured 2026-09-29 with the status pill under the headline as it stands, and the pill is another lane's, so these three drift).
- **Assets are bundled.** `import.meta.glob` includes every file in `images/` in every build (about 2 MB); a file the manifest does not name fails `lib/nultron-images.test.tsx`. Bundled is not loaded: the page requests only what `nx-warm.ts` and the mounted art ask for.
- **A new mount point declares what it can reach.** Pass `next` (a stable array: an effect depends on it) or call `warmMascot` on the event that makes a strip likely; do not add a page-wide warm-up. `lib/nultron-warm.test.tsx` fails a rig that warms everything or a hero that warms on mount.
- **With the cache off, a new `<img>` fetches again.** CDP `Network.setCacheDisabled(true)` (DevTools "Disable cache") makes Chromium request a URL for every new `<img>`, warmed or not. That is why the held art is the same element and why a clip starts after its fetch in that mode. Measure blank frames per animation frame (any visible, loaded image layer), not with screenshots.
- **Busy loops have no live body yet.** Loops are drawn on the body and busy needs `placement="beside"`, and no desk sizes a beside mascot to 64 px or more. `/meeting?mascot=<working state>&mascotBusy=1` (`mascot-slot.tsx:21-30, 83-92`) forces a 72 px body beside a running job to see one; it is a drive hook like `?mascot=`. Setting `data-busy` from the console no longer works: the loop is mounted by React only while busy.
- **No eyes-follow, no blink.** Both belonged to the SVG rig. If the 3D team ships a blink frame, the idle timer that existed (a 130 ms flicker every 4 to 6 s, skipped while the window is idle-paused) can return as a one-shot class on the still.
- **Hero and `--px`/`--py`**: the hero writes them on `.chat-hero`; touch and reduced motion leave them unset, so 0.

## Verify

`.cursor/skills/verify-agentforge/features/mascot.md` (states, sizes, clips, loops, triggers) and `features/chat.md` (the hero). Checks that prove this page:

- `lib/mascot-states.test.ts`, `mascot-triggers.test.ts`, `nultron-mascot-busy.test.tsx`: the state table, triggers, `data-busy`.
- `lib/nultron-images.test.tsx`: the manifest, every file it names present and at the declared size (PNG or WebP header read), clip length 600-1200 ms, loops exactly 4 frames, `bytes`, the markup, `decorative`.
- `lib/nultron-warm.test.tsx`: which files draw a state, that importing or rendering fetches nothing, dedupe, a head never fetches a strip, the idle scheduler and its fallback, what each mount point declares, the hero's byte budget (two stills at idle, two clips on the first touch, under 400 KB), and that a body's loop is mounted only while busy. `lib/nultron-motion.test.ts` also holds that a strip rule waits for `.nx-art[data-sheet]` and that the held still has no animation.
- `lib/meeting-empty-desk.test.tsx` (one character on an empty Meeting, en and id), `lib/onboarding-hero-shapes.test.tsx` (shape geometry against the hero's anatomy, the tier queries), `lib/generate-chip-mascot.test.tsx` (every busy chip is `decorative`, and renders with no role, name or tooltip).
- `lib/nultron-motion.test.ts`, `lib/motion-tokens.test.ts`: the motion contract.
- `lib/brand-assets.test.tsx` (favicon set and links, mark files and `srcset`, display logo small and identical to the portal's) and `apps/desktop/brand-assets.test.cjs` (`.ico` and `.icns` entries, `mac.icon`, the three `logo.png` twins, the splash page): the logo files.
- `apps/desktop/scripts/brand-icons.test.mjs` and `brand-logo-cut.test.mjs` (the kit builders, the cut, the table of repo paths and their pixel sizes, the default source), and `tools/nultron-3d/test/` with `poses/test/` (the image-set check against the app's own contract, the sync, the rig). Neither set is in `pnpm test` or the desktop `test` script; run them by hand.
- Live, on webdev: the rail's `product-logo` is a `span` around an `img` with `currentSrc` `mark-24` (1x) or `mark-48` (2x); at 375 px wide the collapsed rail draws the same mark, and there `product-logo` is the `img` itself. Driven 2026-09-29 in Chromium at device scale 1 and 2: `mark-24.png` at 1x, `mark-48.png` at 2x, drawn at 24 x 24 CSS px, all decoded.
- Live, on webdev: `/meeting?mascot=<state>` for all 21 states in light and dark: the still decodes, the six `once` states carry a clip that plays once and ends on the still, no infinite animation on an idle mascot.

## Why

- **Images, not a live rig.** [Direct] Owner, 2026-09-29: the flat vector look was rejected ("it should be more 3D and realistic, following the reference image"); a three.js scene rendered offline to WebP was approved. The app ships images only. Source: the 3D team's `CONTRACT.md` and the coordinator's hand-off for this change.
- **Timer and loops from files, not CSS filters or a rig.** [Direct] The perf pass of 2026-09-29 measured that on the win32 build (hardware acceleration off) a single running loop costs a software-composited frame per tick; idle-visible `/chat` CPU was 0.10 with every loop paused. Source: `docs/internal/unreleased.md` (2026-09-29 perf entries).
- **Files beside the code, not under `public/`.** [Inferred] The desktop shell loads the renderer with `mainWindow.loadFile` (`apps/desktop/main.cjs`) as `file://`; an absolute `/nultron/...` URL would resolve to the disk's root there, while `import.meta.glob` assets resolve against the bundle. Not proven on a packaged app.
- **The flat brand kit and the SVG rig were built and deleted the same day.** [Direct] Nothing of them is in the tree. The logo that replaced the old chevron is the owner's own painted tile.
- **`logo.png` is 256 px, not the 1024 px the kit's map names.** [Inferred] The brand kit's `replacements.json` points the display logo at a 1024 px, 1 MB file. Its consumers draw it at 24 to 88 CSS px (the portal at 24, the splash at 88): the packaged preload reads it and inlines it as base64 on every launch (`apps/desktop/brand-read.cjs`; 1 ms measured, see section 6), and the portal serves it for a 24 px image. `mark-256.png` is the same art at 256 px and 110 KB, about what the old file weighed. The 1024 px tile is kept where it is the source: `icon.png`, the `.icns` and `mark.png`.
- **The rail mark is imported, not served from `public/`.** [Inferred] Same reason as the mascot files: an absolute `/brand/mark-24.png` would resolve to the disk's root in the packaged `file://` renderer. The favicon set is in `public/brand/` because `index.html` links it and the build rewrites those links.
- **What a page loads is what its mount points can reach, not the whole set.** [Direct] The 2026-09-29 verification pass found `warmStrips` fetching 19 strips (1.31 MB) on every load, the hosted app included, while the first change of state could still draw an empty box for a round trip. Measured the same day (webdev, cold load): `/chat` 20 image requests and 1,338,036 bytes before, 3 and 66,222 after. Source: `docs/internal/unreleased.md`, 2026-09-29 mascot entries.
- **The previous art stays mounted; a strip waits for itself.** [Direct] With the cache off through CDP, a second `<img>` of the old still was an empty box for the whole fetch (17 frames at a 300 ms link), and a clip whose strip was still loading hid the still over nothing. The fix keeps the old element and starts a clip only when its strip is decoded. Source: the drive scripts of 2026-09-29 (blank frames counted per animation frame). [Inferred] that this also holds on a packaged `file://` desk, where the fetch is a disk read; not driven there.
- **The chips beside "Generating…" are decorative; a body's loop mounts only while busy.** [Direct] A screen reader announced the character's name beside the status that already said it; an idle body fetched a loop it could never show (an empty desk's home pose is a working state that is never busy).
