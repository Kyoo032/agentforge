import { useEffect, useRef, useState } from "react";

export const EMIT_LOCK_MS = 5000;

export type EmitLockStartOptions = {
  /** Job pending never holds a lock (G-12). */
  jobPending?: boolean;
};

export type EmitLockController = {
  lockedClipIds: () => string[];
  isActive: () => boolean;
  isLocked: (clipId: string) => boolean;
  onToolStarted: (touching: string[] | undefined, options?: EmitLockStartOptions) => void;
  onCard: () => void;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
};

export function createEmitLock(options?: { lockMs?: number }): EmitLockController {
  const lockMs = options?.lockMs ?? EMIT_LOCK_MS;
  const listeners = new Set<() => void>();
  let ids: string[] = [];
  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function release() {
    clearTimer();
    ids = [];
    active = false;
    emit();
  }

  function armTimer() {
    clearTimer();
    const remaining = Math.max(0, lockMs);
    timer = setTimeout(() => {
      timer = null;
      ids = [];
      active = false;
      emit();
    }, remaining);
  }

  return {
    lockedClipIds: () => ids,
    isActive: () => active,
    isLocked: (clipId) => active && ids.includes(clipId),
    onToolStarted(touching, startOptions) {
      if (startOptions?.jobPending) {
        return;
      }
      ids = Array.isArray(touching) ? [...new Set(touching.filter((id) => typeof id === "string" && id.length > 0))] : [];
      active = true;
      armTimer();
      emit();
    },
    onCard() {
      release();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      clearTimer();
      listeners.clear();
    },
  };
}

export function useEmitLock(): EmitLockController {
  const controllerRef = useRef<EmitLockController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createEmitLock();
  }
  const [, setTick] = useState(0);
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    const stop = controller.subscribe(() => setTick((value) => value + 1));
    return () => {
      stop();
      controller.dispose();
    };
  }, []);
  return controllerRef.current;
}
