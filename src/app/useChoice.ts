import { useState } from 'react';

/**
 * One device-wide choice, applied at once and undone if the device record refuses it.
 * The setter takes a value the record already holds, such as one read again.
 */
export function useChoice<T>(
  read: () => T,
  save: (value: T) => Promise<unknown>,
  onError: (e: unknown) => void,
) {
  const [value, setValue] = useState<T>(read);
  function choose(next: T) {
    const previous = value;
    setValue(next);
    void save(next).catch((error) => {
      setValue(previous);
      onError(error);
    });
  }
  return [value, choose, setValue] as const;
}
