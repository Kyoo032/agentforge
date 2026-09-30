# Poser: requests and contract gaps

Owner: poser. Nothing here blocks POSES_READY. Nothing in `character.js`, `props.js` or `scene-main.js` was edited by the poser.

## For the modeller

1. **Let the lit harness render clips and loops.** `scene-main.js` calls `rig.applyPose(root, P.state, props?.PROPS)`. The rig accepts that (a table of functions as the third argument is taken as the props table), but it cannot receive a time. Please forward two more query values:
   `rig.applyPose(root, P.state, { props: props?.PROPS, t: q.has("t") ? Number(q.get("t")) : undefined, mode: q.get("mode") || undefined })`
   so `node render.mjs --state wave --t 0.5` renders that frame of the wave clip (`mode` is `clip` or `loop`; `poseDuration(state, mode)` and `poseInfo(state)` are exported from `rig.js` for the frame list). Until then the clip strips in `poses/` come from the poser's own lighter harness (`poses/preview.mjs`).
2. **Optional eye variant `nx-eyes-wink`** (a child of `nx-eyes`, like the other five): one eye an open oval, the other the happy arc. The reference "Love" pose winks. `love` asks for `wink`; the rig shows it when the node exists and falls back to `nx-eyes-happy` when it does not (no warning, no other change).
3. **Tell the poser after any change to `layout.js`** (arm length, shoulder position, mitt size, collar or face volume). The poses are stored as angles but authored as world-space hand targets, so the fix is two commands from the workspace root:
   `node poses/build-poses.mjs` (re-solves every arm against the model's real chain, prints a line per arm with the position error and any target beyond reach) and `node poses/tools/clearance.mjs --all` (how deep hands and held props sink into the helmet, face plate, collar and torso).
4. **Reach, for information.** With the current arms (shoulder to wrist 0.31, shoulder to grip about 0.41) the hands cannot reach the ear cups, only the underside of a cup when the head tips toward the hand (`listening` tilts the head 14 degrees for that), and the chin only from the side (`thinking`). Longer arms or a slimmer collar would let those two read more literally; shorter ones would push both toward the belly.
5. **`thumb` hand variant**, low priority: seen from the front the thumb is thin and long, so `celebrating` reads a little like a raised index finger. A shorter, fatter thumb (about the fist's finger thickness) would make the reference's Thumbs Up read at a glance. The pose already points the thumb straight up with the fist turned toward the viewer.

## For the props builder

1. All four requests in `props/requests.md` are done: `filming` mitts lowered and the board pushed forward, `sleep` Zs at (0.85, 1.95), `lets-go` swoosh at x = -0.85, `writing` now hides the companion `tablet` and places `PROPS.tablet` in front of the belly with the stylus tip touching it (the other hand supports it).
2. `wave` fx is placed at (-0.86, 1.02, 0.16), turned 18 degrees, so the arcs sit outboard of the raised hand. If you want them to wrap the fingers instead, say which anchor offset you prefer; the poser cannot judge that from the pose side.
3. Held props are aimed through their `grip` frame with `HELD_ROT = [90, 0, 0]`. `searching` uses `[125, 0, 0]` (the lens leans 35 degrees forward of the hold axis) because the lens (rim 0.54 wide) would otherwise sit inside the face cushion; if the lens is ever resized, that number is `SEARCH_ROT` in `poses/src/states.mjs`.

## Not done, and why

- `poses/sheet-proxy.png` was not produced: the real `character.js` and `dims.json` existed before the proxy sheet was needed, so the proxy (`poses/proxy.js`, kept as a fallback) was only used to validate the angle conventions on day one. The poses are fitted to the real arm lengths and would look wrong on the proxy.
- Body lean on `lets-go` is a plain lean plus a stride, not the reference's three-quarter run; the front view of a stride cannot show it, `sheet-34.png` does.
- Clips are 12 fps keyframes on Euler-style angle triples with easing, not quaternion slerps. That is exact for the poses here; a hand rolled through more than about 150 degrees inside one segment would take the long way round.
