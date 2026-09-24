import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage } from '../src/domain/i18n';
import {
  UploadFailures,
  parseUploadFailure,
  uploadErrorMessage,
  type UploadErrorCategory,
} from '../src/cloud/upload-errors';
import { mountedFixture } from './fixtures/cloud';

const at = '2026/09/25 12:00:00 ERROR : ';
// rclone v1.75.1, vfs/vfscache/writeback/writeback.go `upload`, wrapping item.go `_store`.
const failed = (path: string, cause: string, tries = 1) =>
  `${at}${path}: vfs cache: failed to upload try #${tries}, will retry in 10s: vfs cache: failed to transfer file from cache to remote: ${cause}`;
const upload =
  'Post "https://www.googleapis.com/upload/drive/v3/files/abc?alt=json&uploadType=resumable"';

test('Upload failures are read from rclone log lines as a path and a category only', () => {
  const cases: [UploadErrorCategory, string][] = [
    [
      'permission',
      'googleapi: Error 403: The user does not have sufficient permissions for this file., insufficientFilePermissions',
    ],
    [
      'quota',
      "googleapi: Error 403: The user's Drive storage quota has been exceeded., storageQuotaExceeded",
    ],
    ['auth', 'googleapi: Error 401: Invalid Credentials, authError'],
    [
      'auth',
      `${upload}: couldn't fetch token: oauth2: "invalid_grant" "Token has been expired or revoked."`,
    ],
    [
      'auth',
      'googleapi: Error 403: Insufficient Permission: Request had insufficient authentication scopes., insufficientPermissions',
    ],
    ['network', `${upload}: dial tcp: lookup www.googleapis.com: no such host`],
    ['network', `${upload}: dial tcp 142.250.207.10:443: connect: connection refused`],
    ['network', `${upload}: net/http: TLS handshake timeout`],
    [
      'network',
      `${upload}: couldn't fetch token: Post "https://oauth2.googleapis.com/token": dial tcp: lookup oauth2.googleapis.com: Temporary failure in name resolution`,
    ],
    ['network', 'googleapi: Error 503: The service is currently unavailable., backendError'],
    ['rateLimit', 'googleapi: Error 403: User Rate Limit Exceeded., userRateLimitExceeded'],
    ['rateLimit', 'googleapi: Error 429: Rate Limit Exceeded, rateLimitExceeded'],
    [
      'rateLimit',
      "googleapi: Error 403: Quota exceeded for quota metric 'Queries' and limit 'Queries per minute per user' of service 'drive.googleapis.com'., rateLimitExceeded",
    ],
    ['other', 'vfs cache: failed to find cache file: object not found'],
  ];
  for (const [category, cause] of cases)
    assert.deepEqual(
      parseUploadFailure(failed('folder/file.md', cause)),
      { path: 'folder/file.md', category },
      cause,
    );
  // A name may contain ": ", and its own words never choose the category.
  assert.deepEqual(
    parseUploadFailure(
      failed(
        '会議: メモ/permission denied.md',
        `${upload}: dial tcp: lookup www.googleapis.com: no such host`,
        3,
      ),
    ),
    { path: '会議: メモ/permission denied.md', category: 'network' },
  );
  // Other ERROR lines, the copy that precedes each failed upload, and other levels are not failures.
  for (const line of [
    `${at}folder/file.md: vfs cache: failed to save item info: permission denied`,
    `${at}folder/file.md: Failed to copy: googleapi: Error 403: The user does not have sufficient permissions for this file., insufficientFilePermissions`,
    `2026/09/25 12:00:00 NOTICE: folder/file.md: vfs cache: failed to upload try #1, will retry in 10s: x`,
    `2026/09/25 12:00:00 INFO  : folder/file.md: vfs cache: upload succeeded try #2`,
    'vfs cache: failed to upload try #1, will retry in 10s: googleapi: Error 403',
  ])
    assert.equal(parseUploadFailure(line), undefined, line);
});

test('The collector joins split lines, keeps the last hundred failures and no provider text', () => {
  const failures = new UploadFailures();
  const line = Buffer.from(
    failed(
      '会議: メモ.md',
      'googleapi: Error 403: The user does not have sufficient permissions for this file., insufficientFilePermissions',
    ) + '\r\n',
  );
  // stderr arrives in chunks that can cut a name inside a character.
  const cut = line.indexOf(Buffer.from('メ')) + 1;
  failures.feed(line.subarray(0, cut));
  assert.deepEqual(failures.list(), []);
  failures.feed(line.subarray(cut));
  assert.deepEqual(failures.list(), [{ path: '会議: メモ.md', category: 'permission' }]);
  let log = '';
  for (let i = 0; i < 150; i++)
    log +=
      failed(`notes/${i}.md`, 'googleapi: Error 429: Rate Limit Exceeded, rateLimitExceeded') +
      '\n';
  failures.feed(log);
  const kept = failures.list();
  assert.equal(kept.length, 100);
  assert.deepEqual(kept[0], { path: 'notes/50.md', category: 'rateLimit' });
  assert.deepEqual(kept.at(-1), { path: 'notes/149.md', category: 'rateLimit' });
  for (const failure of kept) assert.deepEqual(Object.keys(failure), ['path', 'category']);
  assert(!JSON.stringify(kept).includes('googleapi'));
});

test('Each category has a message in both languages that names the count', (t) => {
  t.after(() => setLanguage('ja'));
  const all: UploadErrorCategory[] = [
    'permission',
    'quota',
    'auth',
    'network',
    'rateLimit',
    'other',
  ];
  for (const category of all) {
    setLanguage('ja');
    assert.match(uploadErrorMessage(category, 3), /3 件/);
    setLanguage('en');
    assert.match(uploadErrorMessage(category, 3), /3 changes/);
  }
});

test('A connection says why its saved changes are not reaching Google Drive', async (t) => {
  const { cloud, space, rpc } = await mountedFixture(t, { writable: true });
  const queue: Record<string, unknown>[] = [
    { name: 'folder/file.md', id: 1, size: 79, expiry: -1, tries: 1, delay: 5, uploading: true },
    { name: 'folder/other.md', id: 2, size: 10, expiry: 3, tries: 0, delay: 5, uploading: false },
    { name: 'folder/third.md', id: 3, size: 10, expiry: 4, tries: 0, delay: 5, uploading: false },
  ];
  let asked = 0,
    unavailable = false;
  const original = rpc.call.bind(rpc);
  rpc.call = async (method, params) => {
    if (method === 'vfs/stats') return { diskCache: { uploadsInProgress: 1, uploadsQueued: 2 } };
    if (method === 'vfs/queue') {
      asked++;
      assert.equal(params?.fs, 'fixture:');
      if (unavailable) throw Error('Queue unavailable');
      return { queue };
    }
    return original(method, params);
  };
  // Nothing has failed yet: one upload on its first try, the others waiting their turn.
  let [connection] = await cloud.connections(space.scopeId);
  assert.equal(connection.pending, 3);
  assert.equal(connection.uploadError, undefined);
  assert.equal(asked, 1);
  // Two failed tries, reported in rclone's log as a permission problem.
  queue[0] = { ...queue[0], tries: 2, delay: 20, uploading: false };
  rpc.failures = [{ path: 'folder/file.md', category: 'permission' }];
  [connection] = await cloud.connections(space.scopeId);
  assert.match(connection.uploadError!, /書き込む権限がありません.*1 件/);
  assert.equal(connection.pending, 3);
  assert.equal(connection.state, 'mounted');
  // The category the most failing changes share is named, from each file's latest
  // failure; a failing item without a logged reason still counts.
  queue[1] = { ...queue[1], tries: 1 };
  queue[2] = { ...queue[2], tries: 1 };
  rpc.failures = [
    { path: 'folder/file.md', category: 'permission' },
    { path: 'folder/other.md', category: 'network' },
    { path: 'folder/file.md', category: 'network' },
  ];
  [connection] = await cloud.connections(space.scopeId);
  assert.match(connection.uploadError!, /接続できません.*3 件/);
  // A queue that cannot be read leaves the connection with its waiting count alone.
  unavailable = true;
  [connection] = await cloud.connections(space.scopeId);
  assert.equal(connection.state, 'mounted');
  assert.equal(connection.pending, 3);
  assert.equal(connection.uploadError, undefined);
});

test('A read-only connection is never asked about uploads', async (t) => {
  const { cloud, space, rpc } = await mountedFixture(t);
  const original = rpc.call.bind(rpc);
  const asked: string[] = [];
  rpc.call = async (method, params) => {
    asked.push(method);
    return original(method, params);
  };
  rpc.failures = [{ path: 'folder/file.md', category: 'permission' }];
  const [connection] = await cloud.connections(space.scopeId);
  assert.equal(connection.pending, 0);
  assert.equal(connection.uploadError, undefined);
  assert(!asked.some((method) => method.startsWith('vfs/')));
});
