import type { JobEvent } from "./jobs/job-events";
import type { RuntimeEvent } from "./runtime/types";

export type SseEvent = RuntimeEvent | JobEvent;

export function encodeSse(event: SseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
