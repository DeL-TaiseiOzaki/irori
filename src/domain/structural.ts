/**
 * Whether two values read the same: the same primitives, arrays of the same
 * items, or plain objects with the same keys and values. The host's answers are
 * plain data, so a reread that says nothing new can keep the view as it is. A
 * Date, a typed array or any other instance never reads the same as another.
 */
export function sameStructure(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameStructure(item, b[index]));
  }
  if (!plain(a) || !plain(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  const other = b as Record<string, unknown>;
  return keys.every(
    (key) =>
      Object.hasOwn(other, key) && sameStructure((a as Record<string, unknown>)[key], other[key]),
  );
}

function plain(value: object) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
