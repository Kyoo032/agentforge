/**
 * What an Edit card may still offer once its ops are on the timeline.
 *
 * `proposed` has not been written into the document yet, so Keep / Undo / Tweak all apply.
 * `applied` and `kept` are already on the preview: Keep would pretend the change is still a
 * suggestion. Undo and Tweak stay, because the clip can still be rewound or adjusted.
 */
export function editCardOffersKeep(status: string): boolean {
  return status === "proposed";
}

export function editCardOffersRevert(status: string): boolean {
  return status === "proposed" || status === "applied" || status === "kept";
}
