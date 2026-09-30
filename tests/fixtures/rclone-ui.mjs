#!/usr/bin/env node
// Deliberate protocol fixture for cloud UI tests. Never used by normal application startup.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Exercise the host's migration protocol; this format is a fixture, not rclone's native cipher.
if (process.argv[2] === 'config') {
  const config = process.argv[process.argv.indexOf('--config') + 1];
  if (process.argv[4] === 'set') {
    let input = '';
    for await (const bytes of process.stdin) input += bytes;
    const [password, confirmation] = input.trim().split('\n');
    if (!password || password !== confirmation) process.exit(1);
    const nonce = randomBytes(12);
    const key = createHash('sha256').update(password).digest();
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(fs.readFileSync(config)), cipher.final()]);
    fs.writeFileSync(
      config,
      '# Synthetic rclone encryption fixture\nRCLONE_ENCRYPT_V0:\n' +
        Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64'),
      { mode: 0o600 },
    );
  } else if (process.argv[4] === 'check') {
    try {
      const ciphertext = Buffer.from(
        fs.readFileSync(config, 'utf8').split('RCLONE_ENCRYPT_V0:\n')[1],
        'base64',
      );
      const key = createHash('sha256')
        .update(process.env.RCLONE_CONFIG_PASS ?? '')
        .digest();
      const decipher = createDecipheriv('aes-256-gcm', key, ciphertext.subarray(0, 12));
      decipher.setAuthTag(ciphertext.subarray(12, 28));
      decipher.update(ciphertext.subarray(28));
      decipher.final();
    } catch {
      process.exit(1);
    }
  } else process.exit(1);
  process.exit(0);
}
const expected =
  'Basic ' +
  Buffer.from(`${process.env.RCLONE_RC_USER}:${process.env.RCLONE_RC_PASS}`).toString('base64');
const server = http.createServer(async (request, response) => {
  if (request.headers.authorization !== expected) {
    response.writeHead(401).end();
    return;
  }
  let input = '';
  for await (const bytes of request) input += bytes;
  const params = JSON.parse(input || '{}');
  const method = request.url.slice(1);
  let result;
  if (method === 'core/pid') result = { pid: process.pid };
  else if (method === 'core/version') result = { version: 'fixture-only' };
  else if (method === 'mount/types') result = { mountTypes: [] };
  else if (method === 'backend/command')
    result = { result: [{ id: 'shared-fixture', name: '共有ドライブ' }] };
  else if (method === 'operations/list') {
    if (params.fs.root_folder_id === 'folder-second') {
      const marker = (name) => path.join(process.env.IRORI_DATA_DIR, name);
      fs.writeFileSync(marker('folder-pending'), 'pending');
      while (!fs.existsSync(marker('folder-release')))
        await new Promise((resolve) => setTimeout(resolve, 10));
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          list: [{ ID: 'late-folder', Name: '古いアカウントの結果', IsDir: true }],
        }),
      );
      fs.writeFileSync(marker('folder-finished'), 'finished');
      return;
    }
    const work = params.fs.team_drive === 'shared-fixture';
    result = {
      list: work
        ? [{ ID: 'shared-folder', Name: '成果物', IsDir: true }]
        : [
            { ID: 'folder-first', Name: '同じ名前', IsDir: true },
            { ID: 'folder-second', Name: '同じ名前', IsDir: true },
          ],
    };
  } else if (method === 'mount/listmounts') result = { mountPoints: [] };
  else if (method === 'config/delete' && /^irori_[a-f0-9]{32}$/.test(params.name)) result = {};
  else {
    response.writeHead(400).end(JSON.stringify({ error: 'Unsupported fixture method' }));
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(result));
});
server.listen(0, '127.0.0.1', () =>
  process.stderr.write(`Serving remote control on http://127.0.0.1:${server.address().port}/\n`),
);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
