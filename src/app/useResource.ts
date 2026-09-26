import { useEffect, useMemo, useState, type DependencyList } from 'react';
import { errorText } from './ErrorMessage';

// For reads only. Dependencies identify the resource, so old requests cannot update a new one.
// refresh rereads that same resource without hiding its current data.
export function useResource<T>(
  load: () => Promise<T>,
  dependencies: DependencyList,
  { enabled = true, delay = 0, interval = 0, refresh = 0 } = {},
) {
  const request = useMemo(() => ({ load }), [...dependencies, enabled, delay, interval]);
  const [result, setResult] = useState<{ request?: object; data?: T; error?: string }>({});
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function update() {
      try {
        const data = await request.load();
        if (live) setResult({ request, data });
      } catch (error) {
        if (live)
          setResult((previous) => ({
            request,
            data: previous.request === request ? previous.data : undefined,
            error: errorText(error),
          }));
      } finally {
        // Wait for the current read to finish before scheduling another poll.
        if (live && interval) timer = setTimeout(update, interval);
      }
    }
    if (delay) timer = setTimeout(update, delay);
    else void update();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [request, enabled, delay, interval, refresh]);
  const current = enabled && result.request === request ? result : {};
  return {
    data: current.data,
    error: current.error,
    loading: enabled && current.data === undefined && !current.error,
  };
}
