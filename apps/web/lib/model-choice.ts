/**
 * Which model a studio shows and sends, and whether the person chose it.
 *
 * Two different questions share one field. A studio always sends `model`, because a request with no
 * model is one the host has to guess at. Whether that model was *chosen* is a separate flag,
 * `modelPinned`: the host reads it as `modelExplicit` and then never swaps the model when the gateway
 * cannot reach it (`packages/host/src/job-model-fallback.ts`). A seeded default must stay rescuable,
 * so the flag travels only for a deliberate pick.
 */

/** What a studio sends for one job: the model id, and whether the person picked it. */
export type ModelPick = { model: string | undefined; modelPinned: boolean };

/**
 * The model to show after the studio's catalog reloads (Images, Videos and Music reload it after every
 * generate): the current pick while the list still offers it, otherwise the host's default, otherwise
 * the first listed model.
 */
export function keepModelChoice(
  current: string,
  models: ReadonlyArray<{ id: string }>,
  hostDefault: string | undefined,
): string {
  if (current && models.some((model) => model.id === current)) {
    return current;
  }
  return hostDefault || models[0]?.id || "";
}

/** The prompt bar's pick. `pinned` is `useJobModel`'s flag: true only once the picker changed. */
export function studioModelPick(model: string, pinned: boolean): ModelPick {
  const id = model.trim();
  return { model: id || undefined, modelPinned: pinned && id !== "" };
}

/**
 * A rewrite panel's pick. The panel seeds its own select with the studio's model, so the id it sends
 * says nothing about a choice by itself: it is a pick only when the panel moved off the studio's
 * model, or when the studio's model was itself picked.
 */
export function regenModelPick(panelModel: string | undefined, studioModel: string, studioPinned: boolean): ModelPick {
  const panel = panelModel?.trim() ?? "";
  const studio = studioModel.trim();
  const id = panel || studio;
  const movedOff = panel !== "" && panel !== studio;
  return { model: id || undefined, modelPinned: id !== "" && (movedOff || studioPinned) };
}

/** The request fields for a pick. `modelPinned` is sent only when true, as Finance always did. */
export function modelPickBody(pick: ModelPick): { model?: string; modelPinned?: true } {
  return {
    ...(pick.model ? { model: pick.model } : {}),
    ...(pick.modelPinned ? { modelPinned: true as const } : {}),
  };
}
