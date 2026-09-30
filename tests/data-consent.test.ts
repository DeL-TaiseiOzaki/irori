import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DataConsent, dataConsentVersion } from '../src/host/data-consent';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'irori-data-consent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, 'data-consent.json') };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => (resolve = accept));
  return { promise, resolve };
}

test('Concurrent requests share one confirmation and retain independently confirmed purposes', async (t) => {
  const { directory, file } = await fixture(t);
  const entered = deferred<void>();
  const answer = deferred<boolean>();
  const prompts: string[] = [];
  const consent = new DataConsent(directory, async (purpose) => {
    prompts.push(purpose);
    if (purpose === 'google') {
      entered.resolve();
      return answer.promise;
    }
    return true;
  });
  const first = consent.allow('google');
  const second = consent.allow('google');
  const program = consent.allow('programs');
  await entered.promise;
  assert.deepEqual(prompts, ['google']);
  await assert.rejects(consent.require('google'));
  answer.resolve(true);
  await Promise.all([first, second, program]);
  await consent.allow('google');
  await consent.require('google');
  await consent.require('programs');
  assert.deepEqual(prompts, ['google', 'programs']);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(stored.version, dataConsentVersion);
  assert.deepEqual(Object.keys(stored.accepted).sort(), ['google', 'programs']);
  for (const receipt of Object.values(stored.accepted))
    assert(!Number.isNaN(Date.parse(String(receipt))));
  // One purpose never grants another.
  await assert.rejects(consent.require('claude'));
});

test('Rejection leaves no receipt and permits a later explicit confirmation', async (t) => {
  const { directory, file } = await fixture(t);
  let accepted = false;
  let prompts = 0;
  const consent = new DataConsent(directory, async () => {
    prompts++;
    return accepted;
  });
  await assert.rejects(consent.allow('codex'));
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  await assert.rejects(consent.require('codex'));
  accepted = true;
  await consent.allow('codex');
  assert.equal(prompts, 2);
  await new DataConsent(directory, async () => assert.fail('Already confirmed')).require('codex');
});

test('Reset queued behind an open dialog removes its receipt and requires confirmation again', async (t) => {
  const { directory } = await fixture(t);
  const entered = deferred<void>();
  const answer = deferred<boolean>();
  let prompts = 0;
  const consent = new DataConsent(directory, async () => {
    prompts++;
    entered.resolve();
    return answer.promise;
  });
  const allowing = consent.allow('google');
  await entered.promise;
  const resetting = consent.reset();
  answer.resolve(true);
  await Promise.all([allowing, resetting]);
  await assert.rejects(consent.require('google'));
  await consent.allow('google');
  assert.equal(prompts, 2);
});

test('A different disclosure version requires fresh consent despite existing timestamps', async (t) => {
  const { directory, file } = await fixture(t);
  await writeFile(
    file,
    JSON.stringify({
      version: dataConsentVersion + 1,
      accepted: { google: new Date().toISOString(), claude: new Date().toISOString() },
    }),
  );
  let prompts = 0;
  const consent = new DataConsent(directory, async () => {
    prompts++;
    return true;
  });
  await assert.rejects(consent.require('google'));
  await consent.allow('google');
  assert.equal(prompts, 1);
  await assert.rejects(consent.require('claude'));
});

test('Malformed receipts fail closed and can be reset without implicitly granting use', async (t) => {
  const { directory, file } = await fixture(t);
  for (const malformed of [
    '{broken',
    JSON.stringify({ version: dataConsentVersion, accepted: { google: true } }),
    JSON.stringify({ version: dataConsentVersion, accepted: { google: 'not-a-date' } }),
    JSON.stringify({
      version: dataConsentVersion,
      accepted: { unknown: new Date().toISOString() },
    }),
  ]) {
    await writeFile(file, malformed);
    const consent = new DataConsent(directory, async () =>
      assert.fail('Damaged records need reset'),
    );
    await assert.rejects(consent.require('google'));
    await assert.rejects(consent.allow('google'));
    assert.equal(await readFile(file, 'utf8'), malformed);
    await consent.reset();
    await assert.rejects(consent.require('google'));
  }
});
