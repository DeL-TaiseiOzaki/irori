import { useEffect, useMemo, useState, type DependencyList } from 'react';
import { sameStructure } from '../domain/structural';
import { errorText } from './ErrorMessage';

// For reads only. Dependencies identify the resource, so old requests cannot update a new one.
// refresh rereads that same resource without hiding its current data. A reread that
// returns the same data keeps the result as it is, so nothing below re-renders for it.
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
    // A poll that came due while the window was hidden runs once it shows again.
    let due = false;
    async function update() {
      try {
        const data = await request.load();
        if (live)
          setResult((previous) =>
            previous.request === request && !previous.error && sameStructure(previous.data, data)
              ? previous
              : { request, data },
          );
      } catch (error) {
        const text = errorText(error);
        if (live)
          setResult((previous) =>
            previous.request === request && previous.error === text
              ? previous
              : {
                  request,
                  data: previous.request === request ? previous.data : undefined,
                  error: text,
                },
          );
      } finally {
        // Wait for the current read to finish before scheduling another poll.
        if (live && interval) timer = setTimeout(poll, interval);
      }
    }
    function poll() {
      if (document.hidden) due = true;
      else void update();
    }
    function shown() {
      if (document.hidden || !due) return;
      due = false;
      void update();
    }
    if (interval) document.addEventListener('visibilitychange', shown);
    if (delay) timer = setTimeout(update, delay);
    else void update();
    return () => {
      live = false;
      clearTimeout(timer);
      if (interval) document.removeEventListener('visibilitychange', shown);
    };
  }, [request, enabled, delay, interval, refresh]);
  const current = enabled && result.request === request ? result : {};
  return {
    data: current.data,
    error: current.error,
    loading: enabled && current.data === undefined && !current.error,
  };
}
