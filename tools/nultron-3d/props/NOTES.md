# Props: notes for the rig, the modeller and the poser

Owner: props builder. Files: `../props.js` (the registry) and `props/*.js`. Nothing here edits `character.js`, `rig.js` or `poses.json`. Re-checked against the 2026-09-29 volume pass (`dims.json`: `mittRadius` 0.10, ear pods at x = +-0.645, r 0.155); every size below is read from `dims.json` at load, so a regenerated `dims.json` re-fits the props with no edit (`props/dims.js`).

## How the props are built (so the poses can rely on it)

- `PROPS[name]()` returns a fresh `THREE.Group` named `nx-prop-<name>`. Children: `body` (the artwork, scaled by `mittRadius / 0.09` for hand-held props) and a marker empty (`grip` or `anchor`).
- **Hand-held, one hand** (writing, searching, reviewing, painting, editing, presenting, charting-held): `grip` at the point the mitt closes. Drawn with the handle along +Y, the working end toward +Y and the prop's face toward +Z. The poser's `HELD_ROT = [90, 0, 0]` turns that into the hand's hold axis (+Z) and face (-Y). Do not add a second rotation to the `grip` empty: the rig aligns its full frame.
- **Two-handed** (calculating, filming, love/heart): the group origin is the prop's centre and also its `grip` (the midpoint between the mitts). `grip-l` (x < 0) and `grip-r` (x > 0) are where each mitt closes, in the group's frame and already scaled. `twoHanded()` in `poses/src/helpers.mjs` reads exactly these.
- **Worn** (listening): `anchor` at the origin; attach to `nx-head` with pos 0. Coordinates are head-local, from `dims.json` (`earPod.*.centreWorld` minus `head.center`, `radius`, `halfDepth`, `bounds.helmetTopY`). The band passes 0.11 behind the antenna and 0.075 above the dome.
- **Floating / fx**: `anchor` at the origin, which is the visual centre of the mark (the artwork is re-centred). Exceptions: `charging` (the pad's top face is y = 0 and its body hangs to y = -0.17, so the camera must include the ground) and `wave` (the anchor is the hand the arcs open around).
- **Companions**: `writing.body.tablet`, `painting.body.picture`, `presenting.body.board` are children of `body`, placed where they read well next to the prop. The rig's `hide: [name]` drops one so the standalone `PROPS.tablet` / `picture` / `board` (or `charting-screen`) can be placed on its own.
- fx the poses place by name are plain PROPS entries: `thinking`, `surprised`, `celebrating`, `lets-go`, `wave`, `sleep`, `tear` and `heart-mini` (these two replace the rig's own boxes), `spark` (one sparkle), `sparks` (the pointing-up spark lines).
- Materials: `MAT.blue/blueDeep/white/joint/metal` come from `materials.js`, so props match the character. `MAT.face` is vertex-coloured and would render black on a prop, so the brush bristles use a plain cream vinyl. Holo glass, glow and paint are the props' own (`props/mats.js`).
- Transparent pieces (holo panels, rings, glow planes) are normally alpha-blended, never additive. Checked on a transparent background composited over light and dark (`alpha-check.png`): no dark fringes, because `finish-pass.js` receives premultiplied colour.
- `props.js` uses top-level `await` (for `../materials.js` and `../dims.json`) and the bare specifier `three`, like the rest of the folder.

## Requests (all pose-level; none blocks PROPS_READY)

1. `filming`: at `at: [0, 0.9, 0.3]` the clapper arm tucks behind the chin and the two mitts cover most of the board. Lower the pair of mitts about 0.08 or push the board forward (z 0.36) so the striped arm shows above the hands.
2. `sleep`: the Z marks are about 0.55 wide and centred on `pos`; at `[0.5, 1.7, 0.1]` two of the three sit behind the helmet. `pos.x` near 0.85 and `pos.y` near 1.95 puts the whole trail beside the head.
3. `lets-go`: the swoosh is 0.55 wide and centred on `pos`; at x = -0.35 most of it is behind the torso. x = -0.85 puts it fully to the left of the body.
4. `writing`: the default upright hold puts the tablet companion by the cheek. Either aim the stylus forward and down (heldAims `y` about [-0.3, -0.4, 0.85]) or `hide: ["tablet"]` and place `PROPS.tablet` on the other hand (its `anchor` is its centre, size 0.44 x 0.30).
5. `error`: `tear` only appears once the clip reaches frame 9 (`at: 9`); a still render shows no tear. Expected, noted so nobody hunts for it.
