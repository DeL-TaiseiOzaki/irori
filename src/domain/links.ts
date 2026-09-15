import { z } from 'zod';

/**
 * Links that arrive from agent output or document content are untrusted text.
 * Only ordinary web addresses may reach the operating system's browser: every
 * other scheme — `file:`, `javascript:`, `data:`, a custom application handler —
 * would turn a reply into a way to reach the device.
 */
export function webAddress(value: string): URL | undefined {
  if (value.length > 2048) return undefined;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  // A host is what makes the address reachable; `https:///x` and `http://` are not.
  if (!parsed.hostname) return undefined;
  return parsed;
}

export const externalUrl = z
  .string()
  .refine((value) => !!webAddress(value), 'http または https のリンクだけを開けます。');
