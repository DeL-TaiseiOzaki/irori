import { _electron as electron, expect } from '@playwright/test';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';

// Delayed host snapshots must not hide a live approval or resurrect an answered
// request. The fixture drives the real hook without a CLI or account.
const temporary = await mkdtemp(path.join(tmpdir(), 'irori-brain-ai-ui-'));
const server = createServer(async (request, response) => {
  const file = request.url === '/' ? 'index.html' : 'fixture.js';
  response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
  response.end(await readFile(path.join(temporary, file)));
});
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
const fixture = window.brainFixture = {
  calls: 0, listeners: new Set(), pending: [], stream: false,
  snapshot: { id: 'conversation', events: [], queued: [], pending: 0,
    activeRunId: 'run', session: {} },
  emit(event) {
    for (const listener of fixture.listeners) listener({ type: 'agent', event });
  },
  finish() {
    if (fixture.stream) fixture.emit({ scopeId: 'scope', agent: 'pi',
      conversationId: 'conversation', runId: 'run', type: 'text', text: 'Streaming' });
    const next = fixture.pending.shift(); next.resolve(next.value);
  },
};
window.irori = {
  agentConversation: () => {
    fixture.calls++;
    const value = structuredClone(fixture.snapshot);
    return new Promise(resolve => fixture.pending.push({ value, resolve }));
  },
  onEvent: listener => {
    fixture.listeners.add(listener);
    return () => fixture.listeners.delete(listener);
  },
};
const { useBrainAi, openRequest } = await import('./src/app/useBrainAi');
function Fixture() {
  const ai = useBrainAi('scope', 'pi', 0, 'conversation');
  const request = openRequest(ai);
  return <div><output>{request?.text ?? 'No request'}</output>
    <span data-ready={ai.ready}>{ai.events.map(event => event.text).join('|')}</span></div>;
}
createRoot(document.getElementById('app')).render(<Fixture />);`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    outfile: path.join(temporary, 'fixture.js'),
  });
  await writeFile(
    path.join(temporary, 'index.html'),
    '<!doctype html><meta charset="utf-8"><div id="app"></div><script type="module" src="/fixture.js"></script>',
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const harness = path.join(temporary, 'harness.cjs');
  await writeFile(
    harness,
    `const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const window = new BrowserWindow({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.loadURL('http://127.0.0.1:${address.port}/');
});
app.on('window-all-closed', () => app.quit());`,
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), harness],
    env,
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(
    () => !!(window as unknown as { brainFixture?: unknown }).brainFixture,
  );
  type Fixture = {
    calls: number;
    pending: unknown[];
    stream: boolean;
    snapshot: { events: unknown[] };
    emit(event: unknown): void;
    finish(): void;
  };
  const calls = () =>
    page.evaluate(() => (window as unknown as { brainFixture: Fixture }).brainFixture.calls);
  await expect.poll(calls).toBe(1);
  // Every delayed response emits another ordinary fragment. Streaming must not
  // force repeated full-history reads or prevent the first snapshot completing.
  await page.evaluate(() => {
    const fixture = (window as unknown as { brainFixture: Fixture }).brainFixture;
    fixture.stream = true;
    fixture.finish();
  });
  await expect(page.locator('[data-ready]')).toHaveAttribute('data-ready', 'true');
  assert.equal(await calls(), 1);
  await page.evaluate(async () => {
    const fixture = (window as unknown as { brainFixture: Fixture }).brainFixture;
    for (const event of [
      { type: 'permission', requestId: 'other' },
      { type: 'status', resolved: 'other' },
      { type: 'status', role: 'user' },
      { type: 'done' },
    ])
      fixture.emit({
        scopeId: 'scope',
        conversationId: 'other',
        runId: 'other',
        text: '',
        ...event,
      });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  assert.equal(await calls(), 1, 'another conversation cannot invalidate this bound view');
  await expect(page.locator('output')).toHaveText('No request');

  await page.reload();
  await page.waitForFunction(
    () => !!(window as unknown as { brainFixture?: unknown }).brainFixture,
  );
  const permission = {
    scopeId: 'scope',
    agent: 'pi',
    conversationId: 'conversation',
    runId: 'run',
    type: 'permission',
    requestId: 'approval',
    text: 'Allow this change?',
  };
  await expect.poll(calls).toBe(1);
  await page.evaluate((event) => {
    const fixture = (window as unknown as { brainFixture: Fixture }).brainFixture;
    fixture.snapshot.events = [event];
    fixture.emit(event);
  }, permission);
  await expect(page.locator('output')).toHaveText('Allow this change?');
  await page.evaluate(() => (window as unknown as { brainFixture: Fixture }).brainFixture.finish());
  await expect.poll(calls).toBe(2);
  await expect(page.locator('output')).toHaveText('Allow this change?');

  // Answer while the replacement snapshot still contains the approval.
  const resolved = {
    ...permission,
    type: 'status',
    requestId: undefined,
    resolved: 'approval',
    text: 'Answered',
  };
  await page.evaluate((event) => {
    const fixture = (window as unknown as { brainFixture: Fixture }).brainFixture;
    fixture.snapshot.events.push(event);
    fixture.emit(event);
    fixture.finish();
  }, resolved);
  await expect.poll(calls).toBe(3);
  await expect(page.locator('output')).toHaveText('No request');
  await page.evaluate(() => (window as unknown as { brainFixture: Fixture }).brainFixture.finish());
  await expect(page.locator('[data-ready]')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('output')).toHaveText('No request');
  await expect(page.locator('[data-ready]')).toContainText('Answered');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      streamingReads: 1,
      snapshotRace: 'approval retained and answer retained',
      reads: await calls(),
    }),
  );
} finally {
  await app?.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(temporary, { recursive: true, force: true });
}
