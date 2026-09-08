/** Last picker value, plus the model last used on each chat thread. */

const LAST_KEY = "agentforge-chat-model";
const THREAD_KEY = "agentforge-chat-thread-models";
const THREAD_MAP_MAX = 80;

type MemoryStore = Pick<Storage, "getItem" | "setItem">;

function readStore(storage: MemoryStore | undefined, key: string): string {
  if (!storage) {
    return "";
  }
  try {
    return storage.getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
}

function writeStore(storage: MemoryStore | undefined, key: string, value: string): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(key, value);
  } catch {
    // private mode
  }
}

function browserStore(): MemoryStore | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readLastChatModel(storage: MemoryStore | undefined = browserStore()): string {
  return readStore(storage, LAST_KEY);
}

export function writeLastChatModel(id: string, storage: MemoryStore | undefined = browserStore()): void {
  const trimmed = id.trim();
  if (!trimmed) {
    return;
  }
  writeStore(storage, LAST_KEY, trimmed);
}

export function readThreadChatModel(
  threadId: string,
  storage: MemoryStore | undefined = browserStore(),
): string {
  const id = threadId.trim();
  if (!id) {
    return "";
  }
  const raw = readStore(storage, THREAD_KEY);
  if (!raw) {
    return "";
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "";
    }
    const value = (parsed as Record<string, unknown>)[id];
    return typeof value === "string" && value.trim() ? value.trim() : "";
  } catch {
    return "";
  }
}

export function writeThreadChatModel(
  threadId: string,
  modelId: string,
  storage: MemoryStore | undefined = browserStore(),
): void {
  const id = threadId.trim();
  const model = modelId.trim();
  if (!id || !model) {
    return;
  }
  const raw = readStore(storage, THREAD_KEY);
  let map: Record<string, string> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === "string" && value.trim()) {
            map[key] = value.trim();
          }
        }
      }
    } catch {
      map = {};
    }
  }
  const next: Record<string, string> = { ...map, [id]: model };
  const keys = Object.keys(next);
  if (keys.length > THREAD_MAP_MAX) {
    const drop = keys.length - THREAD_MAP_MAX;
    for (const key of keys.slice(0, drop)) {
      delete next[key];
    }
  }
  writeStore(storage, THREAD_KEY, JSON.stringify(next));
}

export function pickChatModel(input: {
  models: Array<{ id: string }>;
  current?: string;
  threadModel?: string;
  lastModel?: string;
  catalogDefault?: string;
}): string {
  const ids = new Set(input.models.map((model) => model.id));
  if (input.threadModel && ids.has(input.threadModel)) {
    return input.threadModel;
  }
  if (input.current && ids.has(input.current)) {
    return input.current;
  }
  if (input.lastModel && ids.has(input.lastModel)) {
    return input.lastModel;
  }
  if (input.catalogDefault && ids.has(input.catalogDefault)) {
    return input.catalogDefault;
  }
  return input.models[0]?.id ?? "";
}
