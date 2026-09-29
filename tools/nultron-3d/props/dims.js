// Sizes the props are fitted to, read from the modeller's ../dims.json (generated from layout.js) and normalised into the
// shape the prop builders use. If dims.json is missing (or lacks a key) the estimates below stand in.
//
//   mittRadius           mitt radius (props are drawn for 0.09 and rescaled by mittRadius / 0.09)
//   head.center          nx-head's world position (head-local origin = helmet centre)
//   earPod.l / .r        head-LOCAL pod centre, radius, full depth (l is at x < 0: left/right are screen-relative)
//   helmet               head-local top y and the three helmet radii
const FALLBACK = {
  mittRadius: 0.085,
  head: { center: [0, 1.5, 0] },
  earPod: {
    l: { center: [-0.615, -0.04, 0], radius: 0.152, depth: 0.19 },
    r: { center: [0.615, -0.04, 0], radius: 0.152, depth: 0.19 },
  },
  helmet: { top: 0.5, radii: { x: 0.6, y: 0.5, z: 0.56 } },
  antennaBaseLocal: [0.055, 0.4856, 0],
};

let raw = null;
try {
  raw = (await import("../dims.json", { with: { type: "json" } })).default ?? null;
} catch (err) {
  console.warn("[props] ../dims.json not available, using estimates:", err?.message ?? err);
}
export const USING_MODELLER_DIMS = raw !== null;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function normalise(d) {
  if (!d) return FALLBACK;
  const centre = d.head?.center ?? FALLBACK.head.center;
  const pod = (side) => {
    const p = d.earPod?.[side];
    if (!p?.centreWorld) return FALLBACK.earPod[side];
    return { center: sub(p.centreWorld, centre), radius: p.radius, depth: (p.halfDepth ?? 0.095) * 2 };
  };
  const top = (d.bounds?.helmetTopY ?? centre[1] + FALLBACK.helmet.top) - centre[1];
  return {
    mittRadius: d.mittRadius ?? FALLBACK.mittRadius,
    head: { center: centre },
    earPod: { l: pod("l"), r: pod("r") },
    helmet: { top, radii: d.head?.radii ?? FALLBACK.helmet.radii },
    antennaBaseLocal: d.antenna?.baseWorld ? sub(d.antenna.baseWorld, centre) : FALLBACK.antennaBaseLocal,
  };
}

export const DIMS = normalise(raw);
