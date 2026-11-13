import type { Readable, Writable } from 'node:stream';

/**
 * What crosses between this device and a vault host on an SSH host (ADR 061):
 * one JSON value a line, with bytes carried as base64. This device asks and the
 * host answers; the host also sends numbered events and asks this device the
 * few things only the person can answer there.
 */
export type Frame =
  | { id: number; method: string; args: unknown[] }
  | { id: number; ok: true; value?: unknown }
  | { id: number; ok: false; error: string }
  | { seq: number; event: unknown }
  | { ask: number; question: string; params: unknown }
  | { answer: number; value: unknown };

/** The longest line read: a viewer's file of 100 MiB as base64, with room to spare. */
const lineLimit = 160 * 1024 * 1024;

export function encode(frame: Frame) {
  return (
    JSON.stringify(frame, function (key, value) {
      // A Buffer's own toJSON has run before the replacer, so look at what was there.
      const raw = (this as Record<string, unknown>)[key];
      return raw instanceof Uint8Array ? { $bytes: Buffer.from(raw).toString('base64') } : value;
    }) + '\n'
  );
}

export function decode(line: string): Frame {
  return JSON.parse(line, (_, value) =>
    value && typeof value === 'object' && typeof value.$bytes === 'string'
      ? new Uint8Array(Buffer.from(value.$bytes, 'base64'))
      : value,
  );
}

/**
 * Calls `on` with each frame read from `stream`, and `end` once when it closes
 * or sends what cannot be read; nothing is read after that.
 */
export function readFrames(stream: Readable, on: (frame: Frame) => void, end: () => void) {
  let buffer = '';
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    end();
  };
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    if (ended) return;
    buffer += chunk;
    for (let at = buffer.indexOf('\n'); at >= 0 && !ended; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      let frame: Frame;
      try {
        frame = decode(line);
      } catch {
        return finish();
      }
      on(frame);
    }
    if (buffer.length > lineLimit) finish();
  });
  stream.on('end', finish);
  stream.on('close', finish);
  stream.on('error', finish);
}

/** Writes one frame; a stream that has closed takes nothing and says so with false. */
export function writeFrame(stream: Writable, frame: Frame) {
  if (stream.destroyed || stream.writableEnded) return false;
  stream.write(encode(frame));
  return true;
}
