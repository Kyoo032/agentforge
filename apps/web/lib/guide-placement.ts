/**
 * Where the guide's card goes relative to the thing it points at. Pure geometry, no DOM: the tour
 * measures the anchor and the card and asks this, so the rules are testable at any viewport in node.
 *
 * The card is placed on the preferred side of the anchor when it fits inside the viewport (with a
 * margin), then on the opposite side, then on the other two. When none fit (a 375px window whose
 * rail is a 68px column, a card wider than the room beside it) or there is no anchor at all, it is
 * centred. Centred is a designed state, not an error: the tour uses it for the welcome card and
 * whenever an anchor is missing, and it can always be placed.
 */
export type GuidePlacement = "right" | "left" | "top" | "bottom" | "center" | "sheet";

export type GuideRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export type GuideSize = { readonly width: number; readonly height: number };

export type GuidePlaced = {
  readonly left: number;
  readonly top: number;
  /** The side actually used. `center` when nothing fit, or when there was nothing to point at. */
  readonly placement: GuidePlacement;
};

export const GUIDE_GAP = 14;
export const GUIDE_MARGIN = 12;

type Side = "right" | "left" | "top" | "bottom";

/**
 * `sheet` is a result, never a request: the card, full width along the bottom of the window, when
 * there is an anchor on screen but no side of it has room for the card (a phone-width window whose
 * rail is a column of icons). The anchor stays ringed above it, which a centred card would cover.
 */
const ORDER: Record<Side, readonly Side[]> = {
  right: ["right", "left", "bottom", "top"],
  left: ["left", "right", "bottom", "top"],
  top: ["top", "bottom", "right", "left"],
  bottom: ["bottom", "top", "right", "left"],
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function centered(card: GuideSize, viewport: GuideSize): GuidePlaced {
  return {
    left: Math.max(0, Math.round((viewport.width - card.width) / 2)),
    top: Math.max(0, Math.round((viewport.height - card.height) / 2)),
    placement: "center",
  };
}

/** True when the anchor has a real box that is at least partly on screen. */
export function isAnchorVisible(anchor: GuideRect | null, viewport: GuideSize): anchor is GuideRect {
  if (!anchor || anchor.width <= 0 || anchor.height <= 0) {
    return false;
  }
  return (
    anchor.left + anchor.width > 0 &&
    anchor.top + anchor.height > 0 &&
    anchor.left < viewport.width &&
    anchor.top < viewport.height
  );
}

export function placeGuideCard(input: {
  readonly anchor: GuideRect | null;
  readonly card: GuideSize;
  readonly viewport: GuideSize;
  readonly preferred: GuidePlacement;
  readonly gap?: number;
  readonly margin?: number;
}): GuidePlaced {
  const { anchor, card, viewport, preferred } = input;
  const gap = input.gap ?? GUIDE_GAP;
  const margin = input.margin ?? GUIDE_MARGIN;
  if (preferred === "center" || !isAnchorVisible(anchor, viewport)) {
    return centered(card, viewport);
  }
  const maxLeft = viewport.width - card.width - margin;
  const maxTop = viewport.height - card.height - margin;
  const anchorCenterX = anchor.left + anchor.width / 2;
  const anchorCenterY = anchor.top + anchor.height / 2;
  // A tall anchor (the whole rail) is pointed at near its top, not at the middle of a 700px column.
  const tall = anchor.height > card.height * 1.6;
  const sideTop = tall ? anchor.top + margin : anchorCenterY - card.height / 2;

  const candidates: Record<Side, { left: number; top: number; fits: boolean }> = {
    right: {
      left: anchor.left + anchor.width + gap,
      top: clamp(sideTop, margin, maxTop),
      fits: anchor.left + anchor.width + gap <= maxLeft,
    },
    left: {
      left: anchor.left - gap - card.width,
      top: clamp(sideTop, margin, maxTop),
      fits: anchor.left - gap - card.width >= margin,
    },
    bottom: {
      left: clamp(anchorCenterX - card.width / 2, margin, maxLeft),
      top: anchor.top + anchor.height + gap,
      fits: anchor.top + anchor.height + gap <= maxTop,
    },
    top: {
      left: clamp(anchorCenterX - card.width / 2, margin, maxLeft),
      top: anchor.top - gap - card.height,
      fits: anchor.top - gap - card.height >= margin,
    },
  };

  const order = preferred === "sheet" ? ORDER.right : ORDER[preferred];
  for (const side of order) {
    const candidate = candidates[side];
    if (candidate.fits) {
      return { left: Math.round(candidate.left), top: Math.round(candidate.top), placement: side };
    }
  }
  // A sheet along the bottom of the window, or along the top when that covers less of the anchor
  // (a 320px window, where the card is 300px tall and the anchor sits in the lower half).
  const bottomTop = clamp(maxTop, margin, maxTop);
  const covered = (top: number) =>
    Math.max(0, Math.min(top + card.height, anchor.top + anchor.height) - Math.max(top, anchor.top));
  return {
    left: clamp(Math.round((viewport.width - card.width) / 2), 0, viewport.width - card.width),
    top: covered(margin) < covered(bottomTop) ? margin : bottomTop,
    placement: "sheet",
  };
}
