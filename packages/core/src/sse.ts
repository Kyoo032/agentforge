import type { RuntimeEvent } from "./runtime/types";

export function encodeSse(event: RuntimeEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
