# Nultron 3D: team contract

Rizky rejected the flat vector mascot: "it should be more 3D and realistic, following the reference image".
We build Nultron as a three.js scene and render it OFFLINE to images. The app ships only images, never three.js.

- Reference: Rizky's character sheets in `docs/internal/brand/nultron/reference/` (`sheet-v3-hires.jpg`, 2000 px, is the one the measurements came from; `sheet-v1.webp` and `sheet-v2.jpg` are earlier). Front view: centre-left figure. App icon tile: bottom-left. The `reference/` folder also holds `app-logo.webp`, which is the LOGO master and has nothing to do with this scene.
- Colours (blue #2688C8, blueDeep #15559A, blueSoft #BFDFF3, face #F6E7D6, white #F8F2E8, joint #232427, eye #212220, glow #38C6DE, glowSoft #ACEFEF, blush #F4A3A3, ink #3B3B3D). These were sampled from the reference; tune under light if a render needs it, and record the change here.
- The flat 2D rig this scene replaced (its SVG, conventions and states table) is deleted from the repo; the 21 states are listed below and authored in `poses/src/states.mjs`. Review sheets from the design rounds are in `docs/internal/brand/nultron/`.
- three.js is pinned in `package.json` at exactly 0.186.1 (`npm ci` installs it under `node_modules/three`, addons under `three/examples/jsm`). Do not add another dependency. The Electron used for the offscreen render is the repo's own (`apps/desktop/node_modules/electron`, found relative to the repo root by `lib/electron.mjs`); `apps/desktop/scripts/brand-icons.mjs` shows the same offscreen-capture pattern for the logo.

## Space and units
- Y up, character faces +Z (toward the default camera), origin on the ground between the feet. 1 unit = the character's total height to the top of the helmet (antenna excluded) divided by 2, so the body stands about 2.0 units tall.

## Scene graph (Object3D names; everyone codes against these)
```
nx-root
└─ nx-body            (pivot: hip centre)
   ├─ nx-torso        (white belly + blue chest), nx-badge (the "N")
   ├─ nx-neck         (pivot) ─ nx-head
   │   ├─ nx-helmet, nx-faceplate, nx-ear-l, nx-ear-r, nx-gem, nx-gem-glow
   │   ├─ nx-antenna  (pivot at base) ─ nx-antenna-tip
   │   ├─ nx-eyes     (children: nx-eyes-open | nx-eyes-blink | nx-eyes-happy | nx-eyes-surprised | nx-eyes-closed; exactly one visible)
   │   ├─ nx-mouth    (children: nx-mouth-idle | nx-mouth-talk | nx-mouth-smile | nx-mouth-sad | nx-mouth-o | nx-mouth-sleep)
   │   └─ nx-blush
   ├─ nx-shoulder-l (pivot) ─ nx-upperarm-l ─ nx-elbow-l (pivot) ─ nx-forearm-l ─ nx-hand-l (pivot: wrist)
   │     └─ children nx-hand-l-open | -point | -thumb | -hold | -fist (one visible), plus nx-grip-l (empty at the grip point)
   ├─ (same for -r)
   ├─ nx-hip-l (pivot) ─ nx-leg-l ─ nx-foot-l
   └─ nx-hip-r (pivot) ─ nx-leg-r ─ nx-foot-r
nx-fx   (floating effects: "?", sparkles, burst lines, swoosh, Z marks, heart, charging ring pad), sibling of nx-body
```
Props attach as children of `nx-grip-l` / `nx-grip-r` (hand-held), `nx-head` (headphones) or `nx-root` / `nx-fx` (charging pad, floating things).

## Shared modules (ES modules in this folder)
- `materials.js` (owner: modeller): `export const MAT = { blue, blueDeep, face, white, joint, eye, gemGlow, blush, ink, metal, glassHolo }` (three.js materials). Until it exists, others use plain MeshStandardMaterial proxies with the palette colours.
- `character.js` (modeller): `export function buildNultron(): THREE.Group` returns `nx-root` per the graph above.
- `rig.js` + `poses.json` (poser): `applyPose(root, stateName)` sets rotations, visibility of the variants and the prop.
- `props.js` (props builder): `export const PROPS = { writing, searching, ... }`, each `() => THREE.Group` named `nx-prop-<name>`, with a child `grip` empty at the point the hand holds; sized to the hand (see the modeller's `dims.json`: `mittRadius`, `earPod` centres and radii, and so on).
- `render.mjs` + `scene.html` (modeller): an Electron offscreen renderer taking `--state --view full|head|icon --size --out`, with a transparent background, supersampled.
- `dims.json` (modeller): the measured sizes others need. Publish it EARLY.

## States
idle, wave, thinking, writing, answering, searching, calculating, charting, reviewing, listening, painting, filming, editing, presenting, celebrating, error, sleep, surprised, love, charging, lets-go.

## Markers
- `LOOK_READY`: the modeller's hero renders are ready for Rizky's review.
- `POSES_READY`, `PROPS_READY`: those modules work on the real model.

---
## Modeller notes (added by the modeller; these are facts of the built model)

**Files**: `layout.js` (all measurements), `geo.js`, `materials.js`, `head.js`, `body.js`, `hands.js`, `character.js`, `dims.json` (generated: `node gen-dims.mjs`), `scene.html` + `scene-main.js` + `render.mjs` (renderer), `check-tree.mjs` (node smoke test of the graph). `package.json` is now `"type": "module"` so `.js` files here are ES modules under node as well as in the browser.

**Left/right are SCREEN-relative** (same as the 2D rig): `-l` is at x < 0 (viewer's left), `-r` at x > 0. The character's own left hand is `-r`.

**Rest pose = all pivot rotations 0**: arms hang straight down, legs straight, head level. Default visible variants: `nx-eyes-open`, `nx-mouth-idle`, `nx-hand-*-fist`. The reference "idle" has the arms angled about 15 degrees outward. Sign rule: a positive rotation about +Z carries a hanging point (0,-1,0) toward +X, so an outward swing is `rotation.z = +a` for `nx-shoulder-r` (x > 0) and `rotation.z = -a` for `nx-shoulder-l` (x < 0); the reference idle is a = 0.26.

**Node kinds** (so nothing needs renaming): `nx-shoulder-*`, `nx-hip-*`, `nx-neck`, `nx-torso` are Meshes (the dark ball / dark column / belly) that also carry children, so the graph is exactly the one above with no extra wrapper nodes. Extra leaf meshes, which you can ignore: `nx-torso-chest` (child of nx-torso), `nx-badge-n`, `nx-bezel` (child of nx-helmet). Chain is nested exactly as drawn: shoulder > upperarm > elbow > forearm > hand > (variants, grip); hip > leg > foot; neck > head.

**Origins (world, rest)**: nx-body (0,0.44,0) hip centre; nx-neck (0,1.02,0); nx-head (0,1.5,0) = helmet centre (children of nx-head are in head-local coords); shoulders (+-0.385,0.86,0); elbow = shoulder + (0,-0.22,0); wrist (nx-hand-*) = elbow + (0,-0.25,0); hips (+-0.2,0.43,0). Full list in `dims.json.pivotsWorld`.

**Hand-local frame** (`nx-hand-*`): axes = world axes at rest, NOT mirrored per side. Origin = wrist, the hand extends down -Y, +Z = front, the palm faces the body. `nx-grip-<side>` is an empty child of the hand; `setHand(root, side, variant)` (exported from `character.js`) shows one variant AND moves the grip to that variant's grip point (`dims.json.hand.gripPoints`, also on `hand.userData.grips`). For `hold` the held object runs along hand-local Z through the curled fingers. `mittRadius` = 0.085.

**Helpers exported by character.js**: `buildNultron({tile?})`, `setEyes(root,name)`, `setMouth(root,name)`, `setHand(root,side,variant)`, `showOnly(group,prefix,name)`, lists `EYES`, `MOUTHS`, `HANDS`.

**Materials**: extras beyond the contract list, usable by props: `MAT.catchlight`, `MAT.gemShell`, `MAT.gemSwirl`, `MAT.antennaBall`, `MAT.earRing`, `MAT.badgeLine`, `MAT.badgeN`. `MAT.glassHolo` is a transmissive, iridescent, double-sided cyan glass for floating screens and rings. All are MeshPhysicalMaterial (or Basic for the catchlights), created without a DOM under node.

**Render harness**: `node render.mjs --state idle --view full|head|icon --size 1024 --out file.png --bg transparent|#rrggbb [--yaw deg]`. scene.html imports `./rig.js` (`applyPose(root, state)`) and `./props.js` (`PROPS`) when they exist and falls back to idle otherwise. For a pose test just run the harness with `--state <name>` after `rig.js` exists.

### Modeller changelog (read `dims.json` again after each of these; it is regenerated every time)
- **2026-09-29, volume pass (Rizky: "too thin and looks scary, more volume around the face and neck")**: PROPORTIONS CHANGED. Node names, parents and the hand-local frame are unchanged; positions and sizes moved:
  - helmet: `rx` 0.60 -> 0.63, `rz` 0.56 -> 0.60, full round dome (no egg taper, no squashed underside). Ear pods: centre x 0.615 -> 0.645 (head-local), radius 0.152 -> 0.155.
  - face plate is now a puffy cushion standing proud of the helmet (`window.puff`, cheeks fuller), inside a thick rolled bezel (lip radius 0.038 -> 0.06). The plate front at the centre is about 0.06 above the old helmet surface: props that sit on the face (headphones band, glasses) should clear `dims.faceplate.plateFrontZAtCentre`.
  - neck: no pinched stem any more. The torso profile now widens to 0.28 at the collar and runs up to y=1.10, so the helmet sits inside a chunky blue collar; `nx-neck` is still at y=1.02.
  - body: belly max radius 0.345 -> 0.372, shoulder pivots (+-0.385,0.86,0) -> **(+-0.415,0.86,0)**, shoulder ball r 0.10 -> 0.11, hip pivots (+-0.20,0.43,0) -> **(+-0.21,0.43,0)**, hip ball r 0.106 -> 0.112, boots wider/rounder (centre x +-0.235). Arm radii 0.118 upper / 0.124 fore, `mittRadius` 0.092 -> **0.10** (hand shapes scale with it; grip points in `dims.hand.gripPoints` scale too). `bounds.width` is now 1.54.
  - the icon-tile helmet is rounder and deeper (`buildNultron({tile:true})`).
- **2026-09-29, earlier (not announced at the time)**: arm segments shortened, shoulder->elbow 0.22 -> **0.13**, elbow->wrist 0.25 -> **0.18** (shoulder->wrist 0.47 -> 0.31, matching the reference where the fist hangs at y = 0.39); belly bottom raised 0.395 -> 0.44 so the hip balls show; mitt radius 0.085 -> 0.092 (then 0.10, above).
- **Idle for the look renders**: `scene-main.js` has `?pose=ref` (`--pose ref`): shoulders +-0.30 outward, elbows back in +-0.16 (bean-shaped sleeves as in the reference). The poser's own `applyPose` is used when `--pose` is not given.
- **2026-09-29, final render set**: `node render-all.mjs --out out` (then `node optimize-png.mjs out/brand`, `node make-contact.mjs out`, `node verify-out.mjs out`; README.md has the whole path into the app) writes `out/` (full 512, head 256, clips and loops as 320 px strips, manifest, brand PNGs, contact sheet). One fixed camera fitted to every pose (stills, clip frames, loop frames) so the character never changes size between states. `scene-main.js` forwards `?t=` and `?mode=clip|loop` to `rig.applyPose`, and `?multi=1` exposes `window.__begin/__frame/__measure/__export` (build once, re-pose many frames). New optional eye variant `nx-eyes-wink` (viewer-left open, viewer-right happy arc) used by `love`. Head close-ups hide the forearms/hands and every prop not attached to `nx-head`, and scale the open eyes by 1.08.
- **2026-09-29, moved into the repo** (`tools/nultron-3d`): paths are repo-relative (`lib/electron.mjs`), the reference images are in `docs/internal/brand/nultron/reference/`, and `scene-main.js` seeds the noise of the ambient-occlusion pass (`AO_NOISE_SEED`) so two renders of the same scene stop differing by random noise. No model, pose or prop changed.
