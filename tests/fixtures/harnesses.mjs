// Explicit native-protocol stand-ins. Never invoke a model or real provider account.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
export function run(kind) {
  if (process.argv.includes('--version')) {
    console.log(kind === 'pi' ? '0.85.1 fixture' : '1.18.30 fixture');
    return;
  }
  const log = (value) =>
    fs.appendFileSync('fixture-requests.jsonl', JSON.stringify({ kind, ...value }) + '\n');
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
