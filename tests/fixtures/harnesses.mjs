// Explicit native-protocol stand-ins. Never invoke a model or real provider account.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
export function run(kind) {
  if (process.argv.includes('--version')) {
    console.log(kind === 'pi' ? '0.85.1 fixture' : '1.18.30 fixture');
    return;
  }
  const log = (value) =>
    fs.appendFileSync('fixture-requests.jsonl', JSON.stringify({ kind, ...value }) + '\n');
  if (kind === 'pi') {
    const session = process.argv.includes('--session')
      ? process.argv[process.argv.indexOf('--session') + 1]
      : path.join(process.cwd(), 'fixture-pi.jsonl');
    const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
    let waiting;
    let active = false;
    const complete = (error = false) => {
      send({ type: 'message_start', message: { role: 'assistant' } });
      send({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: '日本語\u2028の応答' },
      });
      send({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: error ? 'error' : 'stop',
          errorMessage: error ? 'Fixture provider error' : undefined,
          content: [{ type: 'text', text: '日本語\u2028の応答' }],
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
        if (message.message.includes('dialog')) {
          waiting = 'confirm';
          send({
            type: 'extension_ui_request',
            id: 'confirm',
            method: 'confirm',
            title: 'Fixture confirmation',
            message: 'Proceed?',
          });
        } else complete(message.message.includes('fail'));
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
      route: req.url,
      body,
      directory: req.headers['x-opencode-directory'],
    });
    if (req.url === '/event') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sse = res;
      emit('server.connected', {});
      return;
    }
    res.setHeader('content-type', 'application/json');
    if (req.url === '/global/health')
      return res.end(JSON.stringify({ healthy: true, version: 'fixture' }));
    if (req.url === '/session' || (req.url === '/session/' + sessionID && req.method === 'GET')) {
      if (fs.existsSync('fail-resume') && req.method === 'GET') {
        res.writeHead(404);
        return res.end('{}');
      }
      return res.end(JSON.stringify(session));
    }
    if (req.url === '/session/' + sessionID + '/message') {
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
    if (req.url === '/permission/permission/reply') {
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
    if (req.url === '/question/question/reply' || req.url === '/question/question/reject') {
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
