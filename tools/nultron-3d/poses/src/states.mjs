// The 21 states. World coordinates: x + is the viewer's right, y up, z toward the camera; the body stands ~2.0 tall.
// Landmarks (dims.json): shoulders (+-0.385, 0.86), head centre (0, 1.5), helmet radii 0.6 / 0.5 / 0.56, helmet underside
// ~1.04, ear pods (+-0.615, 1.46) r 0.152, torso front z ~0.30 at chest height. The arms are short (reach ~0.38 from the
// shoulder), so hands work at chest height and only just reach the chin or the ear cups; build-poses.mjs warns when a
// target is beyond reach and clamps it.
// IK spec keys: grip [x,y,z] target of the grip point; gripName (hand variant); aims [{ local, world, w, raw? }] where local
// is a hand-frame axis described for the RIGHT hand (0,-1,0 = along the fingers, 0,0,1 = the hold axis, -1,0,0 = the palm
// normal) unless raw; pole = world point the elbow leans toward.
import { blendTo, lean, nudge, off } from "./motion.mjs";
import { HELD_ROT, S, heldAims, propAims, twoHanded } from "./helpers.mjs";

const SEARCH_ROT = [125, 0, 0]; // the magnifier leans 35 degrees forward of the hold axis so the lens clears the face

const F = (name, pos, extra = {}) => ({ name, pos, ...extra });
const REST = { raw: { shoulder: [13, 8, 0], elbow: [12, 0, 0], hand: [0, 0, 0] } };
const FINGERS = [0, -1, 0];
const PALM = [-1, 0, 0];
const ARMS_L = ["shoulder-l", "elbow-l", "hand-l"];
const ARMS_R = ["shoulder-r", "elbow-r", "hand-r"];
const ARMS_BOTH = [...ARMS_L, ...ARMS_R];
const REST_TRIPLES = {
  "shoulder-l": [13, 8, 0],
  "elbow-l": [12, 0, 0],
  "hand-l": [0, 0, 0],
  "shoulder-r": [13, 8, 0],
  "elbow-r": [12, 0, 0],
  "hand-r": [0, 0, 0],
  "hip-l": [0, 2, 0],
  "hip-r": [0, 2, 0],
};

// Two-handed props, placed first so both hands can be aimed at their grip points.
const CALC = twoHanded("calculating", { at: [0, 0.79, 0.32], rot: [-22, 0, 0] });
const FILM = twoHanded("filming", { at: [0, 0.78, 0.36], rot: [-10, 0, 0] });
const HEART = twoHanded("love", { at: [0, 0.72, 0.4], rot: [0, 0, 0], scale: 0.9 });

// Writing: the stylus tip lands on a tablet held out in front of the belly.
const WRITE_DIR = [-0.65, 0.35, 0.68];
const WRITE_GRIP = [0.4, 0.7, 0.26];
const TABLET_AT = [0.05, 0.82, 0.49];

const twoHandAims = heldAims({ y: [0, 1, 0.1], z: [0, -0.1, 1], wy: 0.4, wz: 0.4 });

export const STATES = {
  // ---------------------------------------------------------------------------------------------------------- idle
  idle: {
    note: "Standing, arms a little out and forward like the reference build view.",
    eyes: "open",
    mouth: "idle",
    loopFps: 3,
    loop: (s) => [
      { f: 0 },
      { f: 1, body: off(0, 0.009, 0), pivots: nudge(s, { neck: [-1.2, 0, 0.8], antenna: [0, 0, 5] }) },
      { f: 2 },
      { f: 3, body: off(0, -0.004, 0), pivots: nudge(s, { neck: [0.8, 0, -0.8], antenna: [0, 0, -4] }) },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------- wave
  wave: {
    note: "Reference Friendly Wave: the viewer-left arm up and out, forearm vertical, open palm to the viewer.",
    neck: [0, -3, -4],
    antenna: [0, 0, 6],
    arms: {
      l: {
        grip: S("l", 0.68, 1.06, 0.14),
        gripName: "open",
        aims: [
          { local: FINGERS, world: [-0.15, 1, 0.1], w: 0.3 },
          { local: PALM, world: [0, 0, 1], w: 0.3 },
        ],
        pole: S("l", 0.75, 0.9, 0),
      },
      r: REST,
    },
    handL: "open",
    mouth: "smile",
    fx: [F("wave", [-0.86, 1.02, 0.16], { rot: [0, 0, 18], at: 4, pop: true })],
    clip: (s) => {
      const at = (u) => blendTo(s, REST_TRIPLES, u, ARMS_L);
      const swing = (d, roll) => ({ pivots: nudge(s, { "elbow-l": [d, 0, 0], "hand-l": [0, 0, roll], neck: [0, 1, -d * 0.12] }) });
      return [
        { f: 0, pivots: { ...at(0), neck: [0, 0, 0], antenna: [0, 0, 0] }, eyes: "open", mouth: "idle", handL: "fist" },
        { f: 3, pivots: at(0.9), mouth: "smile", handL: "open", ease: "out" },
        { f: 5, ...swing(-18, -10), ease: "inout" },
        { f: 7, ...swing(16, 10) },
        { f: 9, ...swing(-18, -10) },
        { f: 11, ...swing(12, 8) },
        { f: 13, ...swing(-6, -3) },
        { f: 14 },
      ];
    },
  },

  // ---------------------------------------------------------------------------------------------------------- thinking
  thinking: {
    note: "Reference Thinking: viewer-right fist tucked under the chin, head tilted up and away, a '?' above.",
    neck: [-4, -10, 4],
    antenna: [0, 0, 4],
    arms: {
      l: REST,
      r: {
        grip: S("r", 0.34, 1.02, 0.3),
        aims: [{ local: FINGERS, world: [-0.5, 0.7, 0.5], w: 0.15 }],
        pole: [0.55, 0.85, 0.2],
      },
    },
    eyes: "open",
    mouth: "idle",
    fx: [F("thinking", [0.64, 1.86, 0.05])],
    loop: (s) => [
      { f: 0 },
      { f: 1, pivots: nudge(s, { neck: [1.5, -3, -1.5], antenna: [0, 0, 5] }) },
      { f: 2 },
      { f: 3, pivots: nudge(s, { neck: [-1.5, 3, 1], antenna: [0, 0, -4], "elbow-r": [3, 0, 0] }) },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------- writing
  writing: {
    note: "Stylus held upright in the viewer-right hand at chest height, the tablet floating at its tip; head bowed to it.",
    neck: [9, 6, 0],
    arms: {
      l: { grip: S("l", 0.34, 0.76, 0.38), gripName: "open", aims: [{ local: FINGERS, world: [0.5, 0.1, 0.85], w: 0.2 }, { local: PALM, world: [0.3, 0.9, 0.3], w: 0.2 }], pole: S("l", 0.6, 0.7, 0.1) },
      r: { grip: WRITE_GRIP, gripName: "hold", aims: propAims(HELD_ROT, { y: WRITE_DIR, z: [0.2, -0.6, 0.7], wy: 0.8, wz: 0.15 }), pole: [0.65, 0.7, 0.1] },
    },
    handR: "hold",
    handL: "open",
    eyes: "open",
    mouth: "idle",
    prop: [
      { name: "writing", attach: "grip-r", pos: [0, 0, 0], rot: HELD_ROT, hide: ["tablet"] },
      { name: "tablet", attach: "root", pos: TABLET_AT, rot: [-20, 0, 0] },
    ],
    loopFps: 6,
    loop: (s) => [
      { f: 0 },
      { f: 1, pivots: nudge(s, { "hand-r": [0, 6, 4], "elbow-r": [-2, 0, 0], neck: [1, 0, 0] }) },
      { f: 2 },
      { f: 3, pivots: nudge(s, { "hand-r": [0, -6, -4], "elbow-r": [2, 0, 0], neck: [-0.5, 0, 0] }) },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------- answering
  answering: {
    note: "Writing pose with the head up toward the user and the mouth talking.",
    neck: [2, 4, 0],
    arms: {
      l: { grip: S("l", 0.34, 0.76, 0.38), gripName: "open", aims: [{ local: FINGERS, world: [0.5, 0.1, 0.85], w: 0.2 }, { local: PALM, world: [0.3, 0.9, 0.3], w: 0.2 }], pole: S("l", 0.6, 0.7, 0.1) },
      r: { grip: WRITE_GRIP, gripName: "hold", aims: propAims(HELD_ROT, { y: WRITE_DIR, z: [0.2, -0.6, 0.7], wy: 0.8, wz: 0.15 }), pole: [0.65, 0.7, 0.1] },
    },
    handR: "hold",
    handL: "open",
    eyes: "open",
    mouth: "talk",
    prop: [
      { name: "writing", attach: "grip-r", pos: [0, 0, 0], rot: HELD_ROT, hide: ["tablet"] },
      { name: "tablet", attach: "root", pos: TABLET_AT, rot: [-20, 0, 0] },
    ],
    loopFps: 6,
    loop: (s) => [
      { f: 0 },
      { f: 1, mouth: "idle", pivots: nudge(s, { neck: [-1.5, 0, 0.5] }) },
      { f: 2, mouth: "talk" },
      { f: 3, mouth: "smile", pivots: nudge(s, { neck: [1, 0, -0.5], "hand-r": [0, 5, 3] }) },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------- searching
  searching: {
    note: "Magnifier held up in the viewer-right hand, tipped forward so the lens is in front of the eye; head turned into it.",
    neck: [1, 7, 3],
    arms: {
      l: REST,
      r: { grip: S("r", 0.36, 1.0, 0.3), gripName: "hold", aims: propAims(SEARCH_ROT, { y: [-0.05, 0.6, 0.8], z: [0, -0.8, 0.6], wy: 0.8, wz: 0.6 }), pole: [0.66, 0.95, 0.15] },
    },
    handR: "hold",
    eyes: "open",
    mouth: "idle",
    prop: [{ name: "searching", attach: "grip-r", pos: [0, 0, 0], rot: SEARCH_ROT }],
    loopFps: 4,
    loop: (s) => [
      { f: 0 },
      { f: 1, pivots: nudge(s, { "shoulder-r": [0, -4, 0], neck: [0, -4, 0] }) },
      { f: 2 },
      { f: 3, pivots: nudge(s, { "shoulder-r": [0, 4, 0], neck: [0, 4, 0], "elbow-r": [3, 0, 0] }) },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------- calculating
  calculating: {
    note: "Calculator held in both hands at the chest, tipped back, head bowed to it.",
    neck: [10, 0, 0],
    arms: {
      l: { grip: CALC.gripL, gripName: "hold", aims: twoHandAims, pole: [-0.55, 0.7, 0.1] },
      r: { grip: CALC.gripR, gripName: "hold", aims: twoHandAims, pole: [0.55, 0.7, 0.1] },
    },
    handL: "hold",
    handR: "hold",
    eyes: "open",
    mouth: "idle",
    prop: [CALC.spec],
    loopFps: 4,
    loop: (s) => [
      { f: 0 },
      { f: 1, pivots: nudge(s, { neck: [-2, 0, 0], "hand-r": [-4, 0, 0] }) },
      { f: 2 },
      { f: 3, pivots: nudge(s, { neck: [1, 2, 0], "hand-l": [-4, 0, 0] }) },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------- charting
  charting: {
    note: "Viewer-left index finger pointing at a floating chart screen, head turned to it.",
    neck: [0, -8, -3],
    arms: {
      l: {
        grip: S("l", 0.66, 0.96, 0.22),
        gripName: "point",
        aims: [{ local: FINGERS, world: [-1, 0.5, 0.1], w: 0.4 }],
        pole: S("l", 0.7, 0.75, 0.1),
      },
      r: REST,
    },
    handL: "point",
    eyes: "open",
    mouth: "smile",
    prop: [{ name: "charting-screen", attach: "root", pos: [-0.8, 1.08, 0.25], rot: [0, 22, 0], scale: 0.8 }],
    loopFps: 4,
    loop: (s) => [
      { f: 0 },
      { f: 1, pivots: nudge(s, { "elbow-l": [-4, 0, 0], neck: [0, -2, 0] }) },
      { f: 2 },
      { f: 3, pivots: nudge(s, { "elbow-l": [3, 0, 0], neck: [0, 2, 1] }) },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------- reviewing
  reviewing: {
    note: "Clipboard held up in the viewer-left hand, angled to the viewer; head turned to read it.",
    neck: [6, -14, -3],
    arms: {
      l: {
        grip: S("l", 0.6, 0.8, 0.26),
        gripName: "hold",
        aims: heldAims({ y: [-0.12, 1, 0.2], z: [0, -0.15, 1] }),
        pole: S("l", 0.7, 0.75, 0.1),
      },
      r: REST,
    },
    handL: "hold",
    eyes: "open",
    mouth: "smile",
    prop: [{ name: "reviewing", attach: "grip-l", pos: [0, 0, 0], rot: HELD_ROT }],
    loopFps: 3,
    loop: (s) => [
      { f: 0 },
      { f: 1, pivots: nudge(s, { neck: [2, 2, 0] }) },
      { f: 2 },
      { f: 3, pivots: nudge(s, { neck: [-1, -2, 0], "hand-l": [3, 0, 0] }) },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------- listening
  listening: {
    note: "Headphones on, head tipped to the viewer's right with that hand pressed up under the ear cup.",
    neck: [0, 0, 14],
    antenna: [0, 0, 6],
    arms: {
      l: REST,
      r: {
        grip: S("r", 0.62, 1.1, 0.12),
        gripName: "open",
        aims: [
          { local: FINGERS, world: [0, 1, 0.3], w: 0.25 },
          { local: PALM, world: [-1, 0.1, 0], w: 0.25 },
        ],
        pole: [0.75, 0.95, 0],
      },
    },
    handR: "open",
    eyes: "open",
    mouth: "smile",
    prop: [{ name: "listening", attach: "head", pos: [0, 0, 0], rot: [0, 0, 0] }],
    loopFps: 4,
    loop: (s) => [
      { f: 0 },
      { f: 1, pivots: nudge(s, { neck: [0, 0, -5], antenna: [0, 0, -8] }) },
      { f: 2 },
      { f: 3, pivots: nudge(s, { neck: [0, 0, 3], antenna: [0, 0, 6] }) },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------- painting
  painting: {
    note: "Brush in the viewer-left hand reaching toward a small picture floating at the left.",
    neck: [3, -8, -3],
    arms: {
      l: { grip: S("l", 0.56, 0.84, 0.26), gripName: "hold", aims: heldAims({ y: [-0.55, 0.75, 0.4], z: [-0.2, -0.4, 0.9] }), pole: S("l", 0.7, 0.7, 0.1) },
      r: REST,
    },
    handL: "hold",
    eyes: "open",
    mouth: "smile",
    prop: [
      { name: "painting", attach: "grip-l", pos: [0, 0, 0], rot: HELD_ROT, hide: ["picture"] },
      { name: "picture", attach: "root", pos: [-0.94, 1.02, 0.2], rot: [0, 22, 0], scale: 0.7 },
    ],
    loopFps: 4,
    loop: (s) => [
      { f: 0 },
      { f: 1, pivots: nudge(s, { "hand-l": [0, 8, 6], "elbow-l": [-4, 0, 0] }) },
      { f: 2 },
      { f: 3, pivots: nudge(s, { "hand-l": [0, -8, -6], "elbow-l": [4, 0, 0] }) },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------- filming
  filming: {
    note: "Clapperboard held in both hands at chest height.",
    neck: [4, 0, 0],
    arms: {
      l: { grip: FILM.gripL, gripName: "hold", aims: twoHandAims, pole: [-0.55, 0.8, 0.1] },
      r: { grip: FILM.gripR, gripName: "hold", aims: twoHandAims, pole: [0.55, 0.8, 0.1] },
    },
    handL: "hold",
    handR: "hold",
    eyes: "open",
    mouth: "idle",
    prop: [FILM.spec],
    loopFps: 4,
    loop: (s) => [
      { f: 0 },
      { f: 1, body: off(0, 0.006, 0), pivots: nudge(s, { neck: [-1, 2, 0] }) },
      { f: 2 },
      { f: 3, body: off(0, -0.003, 0), pivots: nudge(s, { neck: [1, -2, 0] }) },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------- editing
  editing: {
    note: "Scissors held out in the viewer-right hand, tipped forward, working on the air in front of the chest.",
    neck: [4, 5, 2],
    arms: {
      l: REST,
      r: { grip: S("r", 0.5, 0.84, 0.26), gripName: "hold", aims: heldAims({ y: [0.35, 0.5, 0.8], z: [0.1, -0.8, 0.5] }), pole: [0.7, 0.75, 0.1] },
    },
    handR: "hold",
    eyes: "open",
    mouth: "idle",
    prop: [{ name: "editing", attach: "grip-r", pos: [0, 0, 0], rot: HELD_ROT }],
    loopFps: 4,
    loop: (s) => [
      { f: 0 },
      { f: 1, pivots: nudge(s, { "hand-r": [0, 6, 0], "elbow-r": [-3, 0, 0] }) },
      { f: 2 },
      { f: 3, pivots: nudge(s, { "hand-r": [0, -6, 0], "elbow-r": [3, 0, 0] }) },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------- presenting
  presenting: {
    note: "Pointer in the viewer-right hand aimed up at a board floating at the right; other hand open, palm up.",
    neck: [0, 8, 3],
    arms: {
      r: { grip: S("r", 0.6, 0.9, 0.2), gripName: "hold", aims: heldAims({ y: [0.75, 0.55, 0.3], z: [0, -0.3, 1], wy: 0.7, wz: 0.4 }), pole: [0.75, 0.8, -0.05] },
      l: {
        grip: S("l", 0.5, 0.84, 0.3),
        gripName: "open",
        aims: [
          { local: FINGERS, world: [-0.4, 0.2, 0.9], w: 0.2 },
          { local: PALM, world: [0, 1, 0.1], w: 0.2 },
        ],
        pole: S("l", 0.6, 0.75, 0.05),
      },
    },
    handR: "hold",
    handL: "open",
    eyes: "open",
    mouth: "smile",
    prop: [
      { name: "presenting", attach: "grip-r", pos: [0, 0, 0], rot: HELD_ROT, hide: ["board"] },
      { name: "board", attach: "root", pos: [0.9, 1.12, 0.12], rot: [0, -22, 0], scale: 0.55 },
    ],
    loopFps: 4,
    loop: (s) => [
      { f: 0 },
      { f: 1, pivots: nudge(s, { "elbow-r": [-4, 0, 0], neck: [0, 2, 0] }) },
      { f: 2 },
      { f: 3, pivots: nudge(s, { "elbow-r": [3, 0, 0], "hand-l": [-4, 0, 0] }) },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------- celebrating
  celebrating: {
    note: "Reference Good Job / Thumbs Up: viewer-left fist with the thumb up, eyes squeezed happy, sparks.",
    neck: [0, -4, -4],
    antenna: [0, 0, 6],
    arms: {
      l: {
        grip: S("l", 0.66, 1.0, 0.2),
        gripName: "thumb",
        aims: [
          { local: [0, 0, 1], world: [0, 1, 0.05], w: 0.6 },
          { local: PALM, world: [0.6, 0, 0.8], w: 0.35 },
        ],
        pole: S("l", 0.8, 0.85, -0.05),
      },
      r: REST,
    },
    handL: "thumb",
    eyes: "happy",
    mouth: "smile",
    fx: [F("celebrating", [-0.7, 1.8, 0.1], { scale: 0.55, at: 6, pop: true })],
    clip: (s) => {
      const from = (u) => blendTo(s, REST_TRIPLES, u, ARMS_L);
      return [
        { f: 0, pivots: { ...from(0), neck: [0, 0, 0], antenna: [0, 0, 0] }, eyes: "open", mouth: "idle", handL: "fist" },
        { f: 2, body: off(0, -0.035, 0), pivots: { ...from(0), neck: [6, 0, 0] }, ease: "out" },
        { f: 5, body: off(0, 0.07, 0), pivots: { ...from(1.12), neck: [-4, -4, -5] }, eyes: "happy", mouth: "smile", handL: "thumb", ease: "out" },
        { f: 8, body: off(0, -0.012, 0), pivots: from(1), ease: "in" },
        { f: 10, body: off(0, 0.008, 0) },
        { f: 12 },
      ];
    },
  },

  // ---------------------------------------------------------------------------------------------------------- error
  error: {
    note: "Reference Sad: head bowed, eyes closed, downturned mouth, shoulders slack, a tear.",
    neck: [13, 0, -6],
    antenna: [8, 0, -6],
    arms: {
      l: { raw: { shoulder: [8, 6, 0], elbow: [18, 0, 0], hand: [0, 0, 0] } },
      r: { raw: { shoulder: [8, 6, 0], elbow: [18, 0, 0], hand: [0, 0, 0] } },
    },
    body: lean(4, 0, -1),
    eyes: "closed",
    mouth: "sad",
    fx: [F("tear", [-0.34, 1.25, 0.54], { at: 9, pop: true })],
    clip: (s) => {
      const arms = (u) => blendTo(s, REST_TRIPLES, u, ARMS_BOTH);
      return [
        { f: 0, pivots: { neck: [0, 0, 0], antenna: [0, 0, 0], ...arms(0) }, body: lean(0, 0, 0), eyes: "open", mouth: "idle" },
        { f: 3, eyes: "closed", mouth: "sad", pivots: { neck: [2, 0, -1], antenna: [1, 0, -1], ...arms(0.2) }, body: lean(0.5, 0, 0), ease: "out" },
        { f: 8, pivots: { neck: [15.5, 0, -7], antenna: [10, 0, -7] }, body: lean(5, 0, -1.2), ease: "inout" },
        { f: 11 },
      ];
    },
  },

  // ---------------------------------------------------------------------------------------------------------- sleep
  sleep: {
    note: "Head dropped and tilted, eyes shut, arms slack, Zs floating up.",
    neck: [15, 0, 9],
    antenna: [6, 0, 8],
    arms: {
      l: { raw: { shoulder: [6, 4, 0], elbow: [14, 0, 0], hand: [0, 0, 0] } },
      r: { raw: { shoulder: [6, 4, 0], elbow: [14, 0, 0], hand: [0, 0, 0] } },
    },
    body: lean(4, 0, 2),
    eyes: "closed",
    mouth: "sleep",
    prop: [{ name: "sleep", attach: "fx", pos: [0.85, 1.95, 0.1], rot: [0, 0, 0] }],
    loopFps: 2,
    loop: (s) => [
      { f: 0 },
      { f: 1, body: { offset: [0, 0.008, 0], lean: [3.2, 0, 2] }, pivots: nudge(s, { neck: [-1.5, 0, 0] }) },
      { f: 2 },
      { f: 3, body: { offset: [0, -0.002, 0], lean: [4.4, 0, 2] }, pivots: nudge(s, { neck: [1, 0, 0] }) },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------- surprised
  surprised: {
    note: "Reference Surprised: both hands up beside the mouth, eyes wide, mouth an 'o', on tiptoe.",
    neck: [-3, 0, 0],
    antenna: [-6, 0, 0],
    arms: {
      l: {
        grip: S("l", 0.42, 1.05, 0.3),
        gripName: "open",
        aims: [
          { local: FINGERS, world: [0.2, 1, 0.1], w: 0.2 },
          { local: PALM, world: [1, 0, 0.4], w: 0.15 },
        ],
        pole: S("l", 0.7, 0.85, 0.05),
      },
      r: {
        grip: S("r", 0.42, 1.05, 0.3),
        gripName: "open",
        aims: [
          { local: FINGERS, world: [-0.2, 1, 0.1], w: 0.2 },
          { local: PALM, world: [-1, 0, 0.4], w: 0.15 },
        ],
        pole: S("r", 0.7, 0.85, 0.05),
      },
    },
    body: off(0, 0.035, 0),
    handL: "open",
    handR: "open",
    eyes: "surprised",
    mouth: "o",
    fx: [F("surprised", [0.46, 1.92, 0.15], { at: 3, pop: true })],
    clip: (s) => {
      const from = (u) => blendTo(s, REST_TRIPLES, u, ARMS_BOTH);
      return [
        { f: 0, pivots: { ...from(0), neck: [0, 0, 0], antenna: [0, 0, 0] }, body: off(0, 0, 0), eyes: "open", mouth: "idle", handL: "fist", handR: "fist" },
        { f: 1, pivots: { ...from(-0.15), neck: [5, 0, 0] }, body: off(0, -0.03, 0), ease: "out" },
        { f: 3, pivots: { ...from(1.08), neck: [-6, 0, 0], antenna: [-12, 0, 0] }, body: off(0, 0.085, 0), eyes: "surprised", mouth: "o", handL: "open", handR: "open", ease: "out" },
        { f: 6, pivots: from(1), body: off(0, 0.02, 0), ease: "inout" },
        { f: 9 },
      ];
    },
  },

  // ---------------------------------------------------------------------------------------------------------- love
  love: {
    note: "Reference With Heart / Love: both hands holding a big blue heart at the belly, head tilted, happy eyes.",
    neck: [2, 0, 4],
    antenna: [0, 0, 6],
    arms: {
      l: { grip: HEART.gripL, gripName: "hold", aims: twoHandAims, pole: [-0.6, 0.65, 0.12] },
      r: { grip: HEART.gripR, gripName: "hold", aims: twoHandAims, pole: [0.6, 0.65, 0.12] },
    },
    handL: "hold",
    handR: "hold",
    eyes: "wink",
    mouth: "smile",
    prop: [{ ...HEART.spec, at: 4, pop: true }],
    fx: [F("heart-mini", [0.66, 1.95, 0.1], { at: 7, pop: true })],
    clip: (s) => {
      const from = (u) => blendTo(s, REST_TRIPLES, u, ARMS_BOTH);
      return [
        { f: 0, pivots: { ...from(0), neck: [0, 0, 0], antenna: [0, 0, 0] }, eyes: "open", mouth: "idle", handL: "fist", handR: "fist", pscale: 1 },
        { f: 4, pivots: { ...from(0.9), neck: [3, 0, 5] }, eyes: "wink", mouth: "smile", handL: "hold", handR: "hold", ease: "out" },
        { f: 6, pivots: from(1), pscale: 1.12, ease: "out" },
        { f: 8, pscale: 0.96, ease: "inout" },
        { f: 10 },
      ];
    },
  },

  // ---------------------------------------------------------------------------------------------------------- charging
  charging: {
    note: "Standing on the charging pad, ring around the body, arms relaxed and a little out, content.",
    neck: [-2, 0, 0],
    antenna: [0, 0, 4],
    arms: {
      l: { raw: { shoulder: [20, 10, 0], elbow: [10, 0, 0], hand: [0, 0, 0] } },
      r: { raw: { shoulder: [20, 10, 0], elbow: [10, 0, 0], hand: [0, 0, 0] } },
    },
    eyes: "open",
    mouth: "smile",
    prop: [{ name: "charging", attach: "root", pos: [0, 0, 0], rot: [0, 0, 0] }],
    loopFps: 3,
    loop: (s) => [
      { f: 0 },
      { f: 1, body: off(0, 0.014, 0), pivots: nudge(s, { antenna: [0, 0, 5] }) },
      { f: 2 },
      { f: 3, body: off(0, -0.006, 0), pivots: nudge(s, { antenna: [0, 0, -4] }) },
    ],
  },

  // ---------------------------------------------------------------------------------------------------------- lets-go
  "lets-go": {
    note: "Reference Let's Go: leaning into a dash toward the viewer's right, right arm pointing the way, left arm swung back.",
    neck: [2, 12, -6],
    antenna: [-6, 0, -8],
    body: { offset: [0.05, 0.05, 0.04], lean: [8, 0, 9] },
    arms: {
      r: { grip: [0.78, 1.0, 0.3], gripName: "point", aims: [{ local: FINGERS, world: [1, 0.15, 0.3], w: 0.3 }], pole: [0.7, 0.72, -0.1] },
      l: { grip: [-0.5, 0.7, -0.22], gripName: "fist", aims: [{ local: FINGERS, world: [-0.4, -0.3, -1], w: 0.15 }], pole: [-0.72, 0.78, -0.1] },
    },
    legs: { l: [-28, 10, 0], r: [32, 6, 0] },
    handR: "point",
    eyes: "open",
    mouth: "smile",
    fx: [F("lets-go", [-0.85, 0.95, -0.1], { at: 6, pop: true })],
    clip: (s) => {
      const from = (u) => blendTo(s, REST_TRIPLES, u, [...ARMS_BOTH, "hip-l", "hip-r"]);
      return [
        { f: 0, pivots: { ...from(0), neck: [0, 0, 0], antenna: [0, 0, 0] }, body: { offset: [0, 0, 0], lean: [0, 0, 0] }, eyes: "open", mouth: "idle", handR: "fist" },
        { f: 3, pivots: { ...from(-0.25), neck: [-3, -4, 3], antenna: [6, 0, 8] }, body: { offset: [-0.02, -0.03, 0], lean: [-4, 0, -6] }, ease: "out" },
        { f: 7, pivots: { ...from(1.12), neck: [3, 14, -7], antenna: [-9, 0, -10] }, body: { offset: [0.06, 0.06, 0.05], lean: [9, 0, 10] }, mouth: "smile", handR: "point", ease: "out" },
        { f: 9, ease: "inout" },
        { f: 11 },
      ];
    },
  },
};
