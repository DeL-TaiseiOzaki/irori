import { useMemo, useRef } from 'react';

type Functions = Record<string, (...args: any[]) => unknown>;

/**
 * The same functions under identities that never change, each calling the
 * latest render's. A memoised child given them re-renders for its data alone,
 * while what they do still reads the current state, as the inline versions did.
 */
export function useStableFunctions<T extends Functions>(functions: T): T {
  const latest = useRef(functions);
  latest.current = functions;
  const names = Object.keys(functions).join();
  return useMemo(
    () =>
      Object.fromEntries(
        Object.keys(latest.current).map((name) => [
          name,
          (...args: unknown[]) => latest.current[name](...args),
        ]),
      ) as T,
    [names],
  );
}
