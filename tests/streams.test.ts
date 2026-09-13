import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../src/host/http';
import { OpenCodeServer } from '../src/agents/opencode';

function fragmented(text: string) {
  const bytes = new TextEncoder().encode(text);
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index === bytes.length) controller.close();
        else controller.enqueue(bytes.subarray(index, ++index));
      },
    }),
  );
}

test('local JSON reads preserve fragmented UTF-8 and reject oversized bodies before completion', async () => {
  assert.deepEqual(await readJson(fragmented('{"text":"日本語"}')), { text: '日本語' });
  assert.equal(await readJson(new Response(null, { status: 204 })), undefined);
  await assert.rejects(readJson(fragmented('{broken')), SyntaxError);
  let cancelled = false,
    reads = 0;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(readJson(response, 8), /exceeds limit/);
  assert.equal(cancelled, true);
  assert.ok(reads <= 4, 'The body must stop at the limit, allowing one stream-prefetched chunk');
});

test('OpenCode SSE handles split UTF-8, all line endings, comments, empty events and multiline JSON', async () => {
  for (const separator of ['\n', '\r\n', '\r']) {
    const events: unknown[] = [];
    const response = fragmented(
      [
        ': heartbeat',
        '',
        'data:',
        '',
        'event: message',
        'data: {"type":"fixture",',
        'data: "text":"日本語"}',
        '',
        '',
      ].join(separator),
    );
    // Exercise the reader without starting a provider or creating a model session.
    await assert.rejects(
      OpenCodeServer.prototype['readEvents'](response, (event) => events.push(event)),
      /event stream disconnected/,
    );
    assert.deepEqual(events, [{ type: 'fixture', text: '日本語' }]);
  }
});

test('OpenCode SSE cancels malformed and oversized streams', async () => {
  for (const [body, message] of [
    ['data: {invalid}\n\n', /JSON|property/],
    ['data: ' + 'x'.repeat(8 * 1024 * 1024 + 1), /exceeds limit/],
  ] as const) {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    await assert.rejects(
      OpenCodeServer.prototype['readEvents'](response, () => assert.fail('Unexpected event')),
      message,
    );
    assert.equal(cancelled, true);
  }
});
