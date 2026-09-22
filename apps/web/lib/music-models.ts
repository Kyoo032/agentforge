/**
 * Two small reading rules the Music studio needs, kept out of the component so they can be tested.
 *
 * The studio renders in a browser and `apps/web`'s Vitest run is node-only over `lib/**`, so a rule
 * that lives inside the component is only ever proven by reading the source. Both of these were
 * wrong in a way a source grep would not have caught, so they live here instead.
 */

/**
 * Whether the model picker has nothing to offer and must explain itself.
 *
 * `ModelSelect` disables itself on an empty list, which renders as a grey control with no options
 * and no reason — the owner read that as "the app does not see my gateway's model". The host now
 * merges the gateway's relay music ids into the list (`withRelayMusicModels`), so this should not
 * happen; it stays as the honest answer if it ever does.
 */
export function musicPickerEmpty(input: { loading: boolean; models: readonly { id: string }[] }): boolean {
  return !input.loading && input.models.length === 0;
}

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text.length > 0 ? text : null;
}

/**
 * The message inside a host error body, whichever of the two shapes it came in.
 *
 * `jsonError` answers an `ApiError` as `{ error: { code, message } }` — that is the tool failure
 * carrying the gateway's own words ("model not enabled for this key", "insufficient quota"). A
 * gateway-gated route answers the flat `{ error: "gateway_blocked", status, message }` instead
 * (`packages/host/src/errors.ts` keeps it flat on purpose, for `parseGatewayBlocked`). Reading only
 * the enveloped shape turned every flat one into a generic failure line, which is the silent
 * failure this exists to stop.
 */
export function readApiErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") {
    return fallback;
  }
  const record = body as Record<string, unknown>;
  const enveloped = record.error;
  if (enveloped && typeof enveloped === "object" && !Array.isArray(enveloped)) {
    return trimmed((enveloped as Record<string, unknown>).message) ?? fallback;
  }
  return trimmed(record.message) ?? fallback;
}
