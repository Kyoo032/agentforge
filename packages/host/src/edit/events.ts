import { EventEmitter } from "node:events";

export type EditHostEvent =
  | { type: "ops.appended"; projectId: string; ops: unknown[]; seq: number }
  | { type: "card.updated"; projectId: string; card: unknown }
  | { type: "job.progress"; projectId: string; jobId: string; progress: number }
  | { type: "job.done"; projectId: string; job: unknown }
  | { type: "job.cancelled"; projectId: string; jobId: string; reason?: string }
  | { type: "unplaced.landed"; projectId: string; item: unknown };

class EditEventBus extends EventEmitter {
  emitEvent(event: EditHostEvent): void {
    this.emit("event", event);
    this.emit(`${event.type}:${event.projectId}`, event);
    this.emit(event.projectId, event);
  }
}

export const editEvents = new EditEventBus();

export function subscribeProjectEvents(projectId: string, listener: (event: EditHostEvent) => void): () => void {
  const wrapped = (event: EditHostEvent) => {
    if (event.projectId === projectId) {
      listener(event);
    }
  };
  editEvents.on("event", wrapped);
  return () => {
    editEvents.off("event", wrapped);
  };
}

export function encodeEditSse(event: { type: string; [key: string]: unknown }): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
