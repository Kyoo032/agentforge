import { AsyncLocalStorage } from "node:async_hooks";
import type { AppLocale } from "@agentforge/core";
import { getBootLocale } from "./locale-boot";

export type RunContext = {
  threadId: string;
  agentId: string;
  locale: AppLocale;
};

const storage = new AsyncLocalStorage<RunContext>();

export function withRunContext<T>(context: RunContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function getRunContext(): RunContext | undefined {
  return storage.getStore();
}

export function localeForRun(): AppLocale {
  return getRunContext()?.locale ?? getBootLocale();
}
