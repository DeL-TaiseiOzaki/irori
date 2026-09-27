// Explicit native-protocol stand-ins. Never invoke a model or real provider account.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { exec } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export function run(kind) {
  if (process.argv.includes('--version')) {
    console.log(
      kind === 'pi'
        ? '0.85.1 fixture'
        : kind === 'hermes'
          ? 'Hermes Agent v2026.9.24 fixture'
          : '1.18.30 fixture',
    );
    return;
  }
  // The model lists as each CLI prints them.
  if (kind === 'opencode' && process.argv[2] === 'models') {
    console.log('anthropic/claude-fixture\nopenrouter/vendor/model-x\nnot a model line');
    return;
  }
  if (kind === 'pi' && process.argv.includes('--list-models')) {
    console.log('provider   model          context  max-out  thinking  images');
    console.log('anthropic  claude-fixture 200K     64K      yes       yes');
    console.log('openai     gpt-fixture    1M       128K     no        no');
    return;
  }
  const log = (value) =>
    fs.appendFileSync('fixture-requests.jsonl', JSON.stringify({ kind, ...value }) + '\n');
  if (kind === 'hermes') return hermes(log);
  // What the real CLI does with the script irori hands it: load it and run its
  // hook for an edit of note.md, here the same edit twice, with no model.
  async function hooks(message) {
    const line = message.includes('line 4') ? 'My own sentence.' : 'An agent paragraph.';
    const file =
      kind === 'pi'
        ? process.argv[process.argv.indexOf('-e') + 1]
        : JSON.parse(process.env.OPENCODE_CONFIG_CONTENT).plugin.at(-1);
    const script = await import(pathToFileURL(file).href);
    const handlers = [];
    if (kind === 'pi') script.default({ on: (type, handler) => handlers.push(handler) });
    else handlers.push((await script.IroriPersonLines({}))['tool.execute.before']);
    const results = [];
    for (let n = 0; n < 2; n++) {
      const [call, args] =
        kind === 'pi'
          ? [
              {
                toolName: 'edit',
                toolCallId: `call-${n}`,
                input: { path: 'note.md', edits: [{ oldText: line, newText: 'Rewritten.' }] },
              },
            ]
          : [
              { tool: 'edit', sessionID: 'ses_fixture', callID: `call-${n}` },
              {
                args: {
                  filePath: path.resolve('note.md'),
                  oldString: line,
                  newString: 'Rewritten.',
                },
              },
            ];
      results.push(
        await handlers[0](call, args).then(
          (result) => ({ reason: result?.reason }),
          (error) => ({ reason: error.message }),
        ),
      );
    }
    for (const result of results) log({ type: 'hook', ...result });
  }
  if (kind === 'pi') {
    log({ type: 'launch', args: process.argv.slice(2) });
    const session = process.argv.includes('--session')
      ? process.argv[process.argv.indexOf('--session') + 1]
      : path.join(process.cwd(), 'fixture-pi.jsonl');
    const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
    let waiting;
    let active = false;
    // A Markdown reply on request, so the renderer can be checked against real
    // assistant formatting instead of plain text only.
    const markdownReply =
      '### 手順\n\n1. \`note.md\` を開く\n2. 見出しを追加\n\n[公開ページ](https://example.com/irori)\n\n[危険](javascript:alert(1))\n\n\`\`\`ts\nconst ok = true;\n\`\`\`\n';
    const complete = (error = false, text = '日本語\u2028の応答') => {
      send({ type: 'message_start', message: { role: 'assistant' } });
      send({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: text },
      });
      send({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: error ? 'error' : 'stop',
          errorMessage: error ? 'Fixture provider error' : undefined,
          content: [{ type: 'text', text }],
        },
      });
      send({ type: 'agent_end', messages: [], willRetry: false });
      setTimeout(() => {
        active = false;
        send({ type: 'agent_settled' });
      }, 20);
    };
    readline.createInterface({ input: process.stdin }).on('line', (line) => {
      const message = JSON.parse(line);
      log(message);
      if (message.type === 'get_state')
        send({
          type: 'response',
          id: message.id,
          command: message.type,
          success: true,
          data: {
            sessionFile: session,
            isStreaming: active,
            isCompacting: false,
            pendingMessageCount: 0,
          },
        });
      if (message.type === 'prompt') {
        if (!fs.existsSync(session))
          fs.writeFileSync(session, JSON.stringify({ type: 'session', cwd: process.cwd() }) + '\n');
        if (message.message.includes('crash')) return process.exit(2);
        if (message.message.startsWith('/fixture')) {
          send({ type: 'response', id: message.id, command: 'prompt', success: true });
          return;
        }
        active = true;
        send({ type: 'agent_start' });
        send({ type: 'response', id: message.id, command: 'prompt', success: true });
        send({ type: 'tool_execution_start', toolName: 'read', args: { path: 'note.md' } });
        // A line "run: <command>" runs it in a shell, as Pi's bash tool would,
        // and answers with what it printed.
        const command = /^run: (.+)$/m.exec(message.message)?.[1];
        if (command) {
          send({ type: 'tool_execution_start', toolName: 'bash', args: { command } });
          exec(command, (error, stdout, stderr) => {
            log({ type: 'command', command, code: error?.code ?? 0, stdout, stderr });
            complete(false, error ? `exit ${error.code}: ${stderr}` : stdout);
          });
          return;
        }
        if (message.message.includes('hold')) return;
        if (message.message.includes('rewrite')) return void hooks(message.message).then(complete);
        if (message.message.includes('dialog')) {
          waiting = 'confirm';
          send({
            type: 'extension_ui_request',
            id: 'confirm',
            method: 'confirm',
            title: 'Fixture confirmation',
            message: 'Proceed?',
          });
        } else
          complete(
            message.message.includes('fail'),
            message.message.includes('markdown') ? markdownReply : undefined,
          );
      }
      if (message.type === 'extension_ui_response') {
        if (waiting === 'confirm') {
          waiting = 'input';
          send({
            type: 'extension_ui_request',
            id: 'input',
            method: 'input',
            title: 'Fixture answer',
          });
        } else complete();
      }
    });
    return;
  }
  let sse;
  let pending;
  const sessionID = 'ses_fixture';
  const session = { id: sessionID, directory: process.cwd() };
  const emit = (type, properties) =>
    sse?.write('data: ' + JSON.stringify({ type, properties }) + '\n\n');
  const finish = () => {
    fs.appendFileSync('note.md', '\nFixture OpenCode edit\n');
    emit('message.updated', { info: { id: 'assistant', sessionID, role: 'assistant' } });
    emit('message.part.delta', {
      sessionID: 'foreign',
      messageID: 'assistant',
      partID: 'foreign',
      field: 'text',
      delta: 'DO NOT DISPLAY',
    });
    emit('message.part.delta', {
      sessionID,
      messageID: 'assistant',
      partID: 'text',
      field: 'text',
      delta: 'OpenCode fixture response',
    });
    pending?.end(
      JSON.stringify({
        info: { role: 'assistant' },
        parts: [{ id: 'text', type: 'text', text: 'OpenCode fixture response' }],
      }),
    );
    pending = undefined;
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = url.pathname;
    const auth =
      'Basic ' +
      Buffer.from(
        process.env.OPENCODE_SERVER_USERNAME + ':' + process.env.OPENCODE_SERVER_PASSWORD,
      ).toString('base64');
    if (req.headers.authorization !== auth) {
      res.writeHead(401);
      res.end();
      return;
    }
    let raw = '';
    for await (const data of req) raw += data;
    const body = raw ? JSON.parse(raw) : undefined;
    log({
      method: req.method,
      route,
      body,
      directory:
        req.headers['x-opencode-directory'] ??
        encodeURIComponent(url.searchParams.get('directory') ?? ''),
    });
    if (route === '/event') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sse = res;
      emit('server.connected', {});
      return;
    }
    res.setHeader('content-type', 'application/json');
    if (route === '/global/health')
      return res.end(JSON.stringify({ healthy: true, version: 'fixture' }));
    if (route === '/session' || (route === '/session/' + sessionID && req.method === 'GET')) {
      if (fs.existsSync('fail-resume') && req.method === 'GET') {
        res.writeHead(404);
        return res.end('{}');
      }
      if (req.method === 'POST')
        session.permission = fs.existsSync('ignore-access') ? undefined : body?.permission;
      return res.end(JSON.stringify(session));
    }
    if (route === '/session/' + sessionID && req.method === 'PATCH') {
      session.permission = fs.existsSync('ignore-access') ? undefined : body.permission;
      return res.end(JSON.stringify(session));
    }
    if (route === '/session/' + sessionID + '/message') {
      const text = body.parts[0].text;
      if (text.includes('crash')) return process.exit(2);
      if (text.includes('fail'))
        return res.end(
          JSON.stringify({
            info: { role: 'assistant', error: { name: 'FixtureFailure' } },
            parts: [],
          }),
        );
      pending = res;
      if (text.includes('hold')) return;
      if (text.includes('rewrite')) return void hooks(text).then(finish);
      if (text.includes('dialog'))
        emit('permission.asked', {
          id: 'permission',
          sessionID,
          permission: 'edit',
          patterns: ['note.md'],
        });
      else finish();
      return;
    }
    if (route === '/permission/permission/reply') {
      res.end('true');
      emit('question.asked', {
        id: 'question',
        sessionID,
        questions: [
          {
            question: 'Fixture answer',
            multiple: true,
            options: [{ label: 'Choice' }, { label: 'Second' }],
          },
        ],
      });
      return;
    }
    if (route === '/question/question/reply' || route === '/question/question/reject') {
      res.end('true');
      finish();
      return;
    }
    res.end('true');
  });
  server.listen(0, '127.0.0.1', () =>
    console.log('opencode server listening on http://127.0.0.1:' + server.address().port),
  );
}

// `hermes chat --query-file - --format stream-json`, as its stream_json.py writes it.
async function hermes(log) {
  const args = process.argv.slice(2);
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  let prompt = '';
  for await (const chunk of process.stdin) prompt += chunk;
  log({ args, prompt });
  const send = (value) =>
    process.stdout.write(JSON.stringify({ ...value, timestamp: Date.now() }) + '\n');
  if (prompt.includes('crash')) process.exit(2);
  const resumed = option('--resume');
  let session = resumed ?? '20260927_120000_fixture';
  send({
    type: 'system',
    subtype: 'init',
    model: option('-m') ?? 'fixture-model',
    session_id: session,
  });
  if (resumed && fs.existsSync('fail-resume')) {
    process.stderr.write('Session not found\n');
    send({
      type: 'result',
      session_id: session,
      exit_code: 1,
      text: '',
      error: 'Session not found',
    });
    process.exit(1);
  }
  send({ type: 'tool_use', name: 'read_file', tool_call_id: 'call-1', input: { path: 'note.md' } });
  if (prompt.includes('hold')) return setInterval(() => {}, 1000);
  send({
    type: 'tool_result',
    name: 'read_file',
    tool_call_id: 'call-1',
    output: '# Fixture',
    duration_ms: 3,
    is_error: false,
  });
  if (prompt.includes('fail')) {
    send({
      type: 'result',
      session_id: session,
      exit_code: 1,
      text: '',
      error: 'Fixture provider error',
    });
    process.exit(1);
  }
  const text = '日本語\u2028の応答';
  if (prompt.includes('final only')) process.stdout.write('not a protocol record\n');
  else for (const part of ['日本語\u2028', 'の応答']) send({ type: 'text', text: part });
  fs.appendFileSync('note.md', '\nFixture Hermes edit\n');
  // A compressed conversation continues under a new id.
  if (prompt.includes('rotate')) session = '20260927_120500_rotated';
  send({
    type: 'result',
    session_id: session,
    exit_code: 0,
    text,
    tokens: { input: 1, output: 1, total: 2, cache_read: 0, cache_write: 0 },
    duration_ms: 5,
  });
  process.stderr.write(`\nsession_id: ${session}\n`);
}
