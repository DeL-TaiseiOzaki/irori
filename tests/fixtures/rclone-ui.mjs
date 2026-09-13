#!/usr/bin/env node
// Deliberate protocol fixture for cloud UI tests. Never used by normal application startup.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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
