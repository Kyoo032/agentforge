import { AsyncLocalStorage } from "node:async_hooks";

export type ToolIoRecord = {
  toolKey: string;
  input: unknown;
  full: unknown;
  thin: unknown;
};

const storage = new AsyncLocalStorage<{ entries: ToolIoRecord[] }>();

export function runWithToolIoSink<T>(fn: () => T): T {
  return storage.run({ entries: [] }, fn);
}

export function reportToolIo(entry: ToolIoRecord): void {
  storage.getStore()?.entries.push(entry);
}

export function takeLastToolIo(toolKey: string): ToolIoRecord | undefined {
  const entries = storage.getStore()?.entries;
  if (!entries) {
    return undefined;
  }
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i]?.toolKey === toolKey) {
      return entries.splice(i, 1)[0];
    }
  }
  return undefined;
}
