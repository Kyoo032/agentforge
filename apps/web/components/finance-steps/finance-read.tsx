"use client";

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";

/** A task whose "read the numbers" step is not the studio's shared parse. */
export type FinanceReadRegistration = {
  readonly run: () => void;
  readonly busy: boolean;
};

type Register = (next: FinanceReadRegistration | null) => void;

const FinanceReadContext = createContext<Register>(() => {});

export function FinanceReadProvider({ children, register }: { children: ReactNode; register: Register }) {
  return <FinanceReadContext.Provider value={register}>{children}</FinanceReadContext.Provider>;
}

/**
 * While this panel is on screen, the one primary button calls `read`.
 * `busy` is true for the local read that the studio's own parse flag does not cover.
 */
export function useFinanceRead(read: () => void, busy: boolean): void {
  const register = useContext(FinanceReadContext);
  const readRef = useRef(read);
  readRef.current = read;
  const publish = useCallback<Register>(
    (next) => {
      register(next);
    },
    [register],
  );
  useEffect(() => {
    publish({
      run: () => {
        readRef.current();
      },
      busy,
    });
    return () => publish(null);
  }, [publish, busy]);
}
