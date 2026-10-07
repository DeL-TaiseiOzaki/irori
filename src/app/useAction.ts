import { useState } from 'react';
import { errorText } from './ErrorMessage';

/**
 * One action a person started: busy while it runs, its failure shown as text or
 * handed to `onError`. `after` runs once it settles either way. `run` resolves
 * whether the action finished.
 */
export function useAction({
  onError,
  after,
}: { onError?: (error: unknown) => void; after?: () => void } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      return true;
    } catch (reason) {
      if (onError) onError(reason);
      else setError(errorText(reason));
      return false;
    } finally {
      setBusy(false);
      after?.();
    }
  }
  return { busy, error, setError, run };
}
