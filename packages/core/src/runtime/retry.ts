export function shouldRetryWithoutTools(options: {
  hasTools: boolean;
  text: boolean;
  failed: string;
  tooled: boolean;
}): boolean {
  if (!options.hasTools || options.tooled) {
    return false;
  }
  if (!options.text && !options.failed) {
    return true;
  }
  return /function tools|reasoning_effort/i.test(options.failed);
}

/** Empty assistant reply is only a hard failure when no tools ran (e.g. image_generate with no prose). */
export function shouldFailEmptyAssistant(options: {
  text: boolean;
  thinking: boolean;
  tooled: boolean;
}): boolean {
  return !options.text && !options.thinking && !options.tooled;
}

/** Keep a tool turn (image/video generate) even if a later provider fetch fails. */
export function shouldKeepToolTurn(options: { tooled: boolean; failed: string }): boolean {
  return options.tooled && options.failed.trim().length > 0;
}
