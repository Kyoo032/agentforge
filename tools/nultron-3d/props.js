// Nultron 3D props. `PROPS[name]()` returns a fresh THREE.Group named `nx-prop-<name>`.
//
// Conventions (rig.js is the consumer):
//   hand-held  -> child empty `grip` (rig.js puts it on the pos you give). Drawn with the handle along +Y, the working end
//                 toward +Y and the face toward +Z; the poser's HELD_ROT [90, 0, 0] turns that into the hand's hold axis
//                 (+Z) and face (-Y). Two-handed props (calculating, filming, love): the origin is their centre and
//                 also their `grip`; `grip-l` / `grip-r` (screen-relative: l is x < 0) mark where each mitt closes.
//   worn       -> child empty `anchor`; attach to nx-head with pos 0 (listening). Coordinates are head-local.
//   floating   -> child empty `anchor`; attach to nx-fx or nx-root. Their origin is their visual centre except
//                 `charging`, whose ground pad has its top face at y = 0.
// Hand-held props are drawn for a mitt radius of 0.09 and rescaled to dims.json's `mittRadius`.
// Companions are named children of `body` (writing -> `tablet`, painting -> `picture`, presenting -> `board`); the rig's
// `hide: [name]` removes one so the same piece can be placed on its own via the standalone `tablet` / `picture` / `board`.
// fx marks the poser places by name are plain PROPS entries too (thinking, surprised, celebrating, lets-go, wave, sleep,
// tear, heart-mini).
import { board, charting, chartingScreen, charging, holoCards, holoRing, love, picture, tablet } from "./props/floating.js";
import { celebrating, heartBubble, letsGo, sleep, sparkOne, sparks, surprised, tear, thinking, wave } from "./props/fx.js";
import { calculating, chartingHeld, reviewing, searching, writing } from "./props/held1.js";
import { editing, filming, painting, presenting } from "./props/held2.js";
import { listening } from "./props/worn.js";

export const PROPS = {
  // hand-held
  writing,
  searching,
  calculating,
  charting,
  reviewing,
  painting,
  filming,
  editing,
  presenting,
  // worn
  listening,
  // floating
  charging,
  love,
  heart: love, // the poser's name for the love prop
  thinking,
  surprised,
  celebrating,
  "lets-go": letsGo,
  wave,
  sleep,
  "holo-ring": holoRing,
  "holo-cards": holoCards,
  // companions and extras
  picture,
  board,
  tablet,
  "charting-screen": chartingScreen,
  "charting-held": chartingHeld,
  sparks,
  // fx pieces the poser places by name (rig.js falls back to its own boxes for "tear" / "heart-mini"; these replace them)
  tear,
  "heart-mini": heartBubble,
  spark: sparkOne,
};

/** Names grouped the way the sheet and the poser think about them. */
export const PROP_GROUPS = {
  held: ["writing", "searching", "calculating", "reviewing", "painting", "filming", "editing", "presenting", "charting-held"],
  worn: ["listening"],
  floating: ["charging", "love", "charting", "thinking", "surprised", "celebrating", "lets-go", "wave", "sleep", "holo-ring", "holo-cards"],
  extras: ["picture", "board", "tablet", "sparks", "spark", "heart-mini", "tear"],
};

export function buildProp(name) {
  const make = PROPS[name];
  if (!make) throw new Error(`unknown prop "${name}"`);
  return make();
}
