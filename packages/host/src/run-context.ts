import { AsyncLocalStorage } from "node:async_hooks";

export type RunContext = {
  threadId: string;
  agentId: string;
};

const storage = new AsyncLocalStorage<RunContext>();

export function withRunContext<T>(context: RunContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function getRunContext(): RunContext | undefined {
  return storage.getStore();
}
