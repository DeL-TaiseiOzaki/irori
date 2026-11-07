import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  SchemaHookRunner,
  folderHooks,
  matcherTakes,
  schemaHooks,
  type SchemaHook,
} from '../src/agents/schema-hooks';
import { cliToolInput, hookTool } from '../src/agents/tool-names';
import { RunHooks } from '../src/agents/run-hooks';

const posix = { skip: process.platform === 'win32' && 'POSIX shell hooks', timeout: 30000 };

test('a matcher is read as Claude Code reads it', () => {
  assert.equal(matcherTakes(undefined, 'Bash'), true);
  assert.equal(matcherTakes('', 'Bash'), true);
  assert.equal(matcherTakes('*', 'Bash'), true);
  assert.equal(matcherTakes('Bash', 'Bash'), true);
  assert.equal(matcherTakes('Bash', 'BashOutput'), false, 'a plain name matches exactly');
  assert.equal(matcherTakes('Edit|Write', 'Write'), true);
  assert.equal(matcherTakes('Edit, Write', 'Edit'), true);
  assert.equal(matcherTakes('Notebook.*', 'NotebookEdit'), true, 'otherwise a regular expression');
  assert.equal(matcherTakes('mcp__.*__write', 'mcp__files__write'), true);
  assert.equal(matcherTakes('Bash', 'Shell', ['bash', 'Bash']), true, "the CLI's own name too");
  assert.equal(matcherTakes('(', 'Bash'), false, 'a broken expression takes nothing');
});

test("a Schema's hooks are read in Claude Code's shape, and a malformed value is refused", async (t) => {
  const hooks = schemaHooks(
    {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard', timeout: 5 }] }],
      Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:1/stop' }] }],
    },
    'shared',
  );
  assert.deepEqual(hooks, [
    {
      event: 'PreToolUse',
      matcher: 'Bash',
      type: 'command',
      command: 'guard',
      timeout: 5,
      from: 'shared',
    },
    { event: 'Stop', type: 'http', command: '', url: 'http://127.0.0.1:1/stop', from: 'shared' },
  ]);
  assert.throws(() => schemaHooks({ PreToolUse: 'guard' }, 'folder'), /Claude Code's shape/);
  const base = await mkdtemp(path.join(tmpdir(), 'irori folder hooks '));
  t.after(() => rm(base, { recursive: true, force: true }));
  assert.deepEqual(await folderHooks(base), []);
  await mkdir(path.join(base, '.claude'));
  await writeFile(
    path.join(base, '.claude', 'settings.json'),
    JSON.stringify({
      env: { A: '1' },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] },
    }),
  );
  assert.deepEqual(await folderHooks(base), [
    { event: 'Stop', type: 'command', command: 'x', from: 'folder' },
  ]);
});

async function runner(
  t: import('node:test').TestContext,
  hooks: Omit<SchemaHook, 'from' | 'type'>[],
) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'irori hook runner ')));
  t.after(() => rm(base, { recursive: true, force: true }));
  return {
    base,
    runner: new SchemaHookRunner(
      hooks.map((hook) => ({ type: 'command', from: 'folder' as const, ...hook })),
      {
        cwd: base,
        env: { ...process.env, IRORI_TEST: 'yes' },
        agent: 'pi',
        fields: () => ({ session_id: 'session-1', cwd: base, permission_mode: 'default' }),
      },
    ),
  };
}

test(
  'a hook hears the event on standard input, in the folder, with CLAUDE_PROJECT_DIR',
  posix,
  async (t) => {
    const { base, runner: hooks } = await runner(t, [
      {
        event: 'PreToolUse',
        command:
          'cat > heard.json; printf "%s|%s|%s" "$CLAUDE_PROJECT_DIR" "$IRORI_HOOK_CLI" "$IRORI_TEST" > env.txt',
      },
    ]);
    const outcome = await hooks.run(
      'PreToolUse',
      { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'call-1' },
      { value: 'Bash' },
    );
    assert.deepEqual(outcome, { context: [], notices: [] });
    assert.deepEqual(JSON.parse(await readFile(path.join(base, 'heard.json'), 'utf8')), {
      session_id: 'session-1',
      cwd: base,
      permission_mode: 'default',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_use_id: 'call-1',
    });
    assert.equal(await readFile(path.join(base, 'env.txt'), 'utf8'), `${base}|pi|yes`);
  },
);

test('exit codes and JSON output decide as in Claude Code', posix, async (t) => {
  const { runner: hooks } = await runner(t, [
    { event: 'PreToolUse', matcher: 'Bash', command: 'echo "no shell here" >&2; exit 2' },
    {
      event: 'PreToolUse',
      matcher: 'Write',
      command: `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"check it"}}'`,
    },
    {
      event: 'PreToolUse',
      matcher: 'Read',
      command: `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"file_path":"other.md"},"additionalContext":"read carefully"}}'`,
    },
    {
      event: 'PreToolUse',
      matcher: 'Grep',
      command: `printf '%s' '{"decision":"block","reason":"old style"}'`,
    },
    {
      event: 'PostToolUse',
      matcher: 'Edit',
      command: `printf '%s' '{"decision":"block","reason":"run the formatter"}'`,
    },
    { event: 'PostToolUse', matcher: 'Write', command: 'echo "lint failed" >&2; exit 2' },
    { event: 'UserPromptSubmit', command: 'echo "today is a holiday"' },
    { event: 'Stop', command: `printf '%s' '{"decision":"block","reason":"tests are red"}'` },
    {
      event: 'SessionStart',
      matcher: 'startup',
      command: `printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"branch main"}}'`,
    },
    { event: 'SessionStart', matcher: 'resume', command: 'exit 3' },
    {
      event: 'Notification',
      command: `printf '%s' '{"systemMessage":"seen","continue":false,"stopReason":"enough"}'`,
    },
  ]);
  assert.equal((await hooks.run('PreToolUse', {}, { value: 'Bash' })).blocked, 'no shell here');
  assert.equal((await hooks.run('PreToolUse', {}, { value: 'Write' })).ask, 'check it');
  const read = await hooks.run('PreToolUse', {}, { value: 'Read' });
  assert.deepEqual(read.input, { file_path: 'other.md' });
  assert.deepEqual(read.context, ['read carefully']);
  assert.equal(read.blocked, undefined);
  assert.equal((await hooks.run('PreToolUse', {}, { value: 'Grep' })).blocked, 'old style');
  assert.deepEqual((await hooks.run('PostToolUse', {}, { value: 'Edit' })).context, [
    'run the formatter',
  ]);
  assert.deepEqual((await hooks.run('PostToolUse', {}, { value: 'Write' })).context, [
    'lint failed',
  ]);
  assert.deepEqual((await hooks.run('UserPromptSubmit', { prompt: 'hi' })).context, [
    'today is a holiday',
  ]);
  assert.equal((await hooks.run('Stop', { stop_hook_active: false })).blocked, 'tests are red');
  assert.deepEqual((await hooks.run('SessionStart', {}, { value: 'startup' })).context, [
    'branch main',
  ]);
  const resumed = await hooks.run('SessionStart', {}, { value: 'resume' });
  assert.equal(resumed.blocked, undefined);
  assert.match(resumed.notices[0], /non-blocking status code 3/);
  const notification = await hooks.run('Notification', {}, { value: 'permission_prompt' });
  assert.deepEqual(notification.notices, ['seen']);
  assert.equal(notification.halt, 'enough');
  // No hook of the event, or none whose matcher takes it: nothing happens.
  assert.deepEqual(await hooks.run('PreToolUse', {}, { value: 'Glob' }), {
    context: [],
    notices: [],
  });
});

test(
  'hooks run at once, a command named twice once, and a slow one times out',
  posix,
  async (t) => {
    const { base, runner: hooks } = await runner(t, [
      { event: 'Stop', command: 'echo one >> ran.txt' },
      { event: 'Stop', command: 'echo one >> ran.txt' },
      { event: 'Stop', command: 'sleep 0.3; echo two >> ran.txt' },
      { event: 'Stop', command: 'sleep 0.3; echo three >> ran.txt' },
      { event: 'Stop', command: 'sleep 30', timeout: 1 },
    ]);
    const started = Date.now();
    const outcome = await hooks.run('Stop', { stop_hook_active: false });
    assert.ok(Date.now() - started < 5000, 'parallel, and the slow one stopped at its timeout');
    assert.deepEqual(outcome.notices, ['Stop: timed out after 1 s']);
    const lines = (await readFile(path.join(base, 'ran.txt'), 'utf8')).trim().split('\n').sort();
    assert.deepEqual(lines, ['one', 'three', 'two']);
  },
);

test("a Pi tool call is named and shaped as Claude Code's tool, and a hook's input maps back", () => {
  assert.deepEqual(hookTool('pi', 'bash', { command: 'ls', timeout: 5 }), {
    name: 'Bash',
    input: { command: 'ls', timeout: 5 },
  });
  assert.deepEqual(hookTool('pi', 'write', { path: 'a.md', content: 'x' }), {
    name: 'Write',
    input: { file_path: 'a.md', content: 'x' },
  });
  assert.deepEqual(
    hookTool('pi', 'edit', { path: 'a.md', edits: [{ oldText: 'a', newText: 'b' }] }),
    {
      name: 'Edit',
      input: { file_path: 'a.md', old_string: 'a', new_string: 'b' },
    },
  );
  assert.equal(
    hookTool('pi', 'edit', {
      path: 'a.md',
      edits: [
        { oldText: 'a', newText: 'b' },
        { oldText: 'c', newText: 'd' },
      ],
    }).name,
    'MultiEdit',
  );
  assert.deepEqual(hookTool('pi', 'custom', { x: 1 }), { name: 'custom', input: { x: 1 } });
  assert.deepEqual(
    cliToolInput(
      'pi',
      'edit',
      { path: 'a.md', edits: [] },
      { file_path: 'b.md', old_string: 'x', new_string: 'y' },
    ),
    { path: 'b.md', edits: [{ oldText: 'x', newText: 'y' }] },
  );
  assert.equal(cliToolInput('pi', 'custom', {}, { a: 1 }), undefined);
});

test('a run answers its CLI as the hooks decide: deny, ask, input, feedback', posix, async (t) => {
  const { runner: hooks } = await runner(t, [
    { event: 'PreToolUse', matcher: 'Bash', command: 'echo "no rm" >&2; exit 2' },
    {
      event: 'PreToolUse',
      matcher: 'Write',
      command: `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"sure?"}}'`,
    },
    {
      event: 'PreToolUse',
      matcher: 'Read',
      command: `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"file_path":"b.md"},"additionalContext":"b is newer"}}'`,
    },
    { event: 'PostToolUse', matcher: 'Read', command: 'echo "keep it short" >&2; exit 2' },
  ]);
  const asked: string[] = [];
  const said: string[] = [];
  let allow = false;
  const run = new RunHooks(hooks, 'pi', {
    status: (text) => said.push(text),
    ask: async (text) => {
      asked.push(text);
      return allow;
    },
    halt: () => {},
  });
  assert.match(
    (
      await run.answer({
        event: 'PreToolUse',
        tool: 'bash',
        input: { command: 'rm -rf x' },
        call: '1',
      })
    ).block ?? '',
    /^A PreToolUse hook of the Schema blocked this call: no rm$/,
  );
  assert.ok(
    (await run.answer({ event: 'PreToolUse', tool: 'write', input: { path: 'a', content: '' } }))
      .block,
  );
  allow = true;
  assert.deepEqual(
    await run.answer({ event: 'PreToolUse', tool: 'write', input: { path: 'a', content: '' } }),
    {},
  );
  assert.equal(asked.length, 2);
  assert.deepEqual(
    await run.answer({ event: 'PreToolUse', tool: 'read', input: { path: 'a.md' }, call: '7' }),
    { input: { path: 'b.md' } },
  );
  const after = await run.answer({
    event: 'PostToolUse',
    tool: 'read',
    input: { path: 'b.md' },
    call: '7',
    output: [],
  });
  assert.equal(
    after.feedback,
    'PostToolUse hook feedback from the Schema:\nb is newer\nkeep it short',
  );
  assert.deepEqual(said, []);
});

test("a hook's command runs in sh, or on Windows in Git Bash, else cmd.exe as written", async (t) => {
  const { hookShell } = await import('../src/agents/schema-hooks');
  assert.deepEqual(hookShell('echo hi', 'linux'), ['/bin/sh', ['-c', 'echo hi'], false]);
  const base = await mkdtemp(path.join(tmpdir(), 'irori hook shell '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const bash = path.join(base, 'bash.exe');
  await writeFile(bash, '');
  assert.deepEqual(hookShell('echo hi', 'win32', { CLAUDE_CODE_GIT_BASH_PATH: bash }), [
    bash,
    ['-c', 'echo hi'],
    false,
  ]);
  assert.deepEqual(
    hookShell('echo hi', 'win32', { ProgramFiles: base, ComSpec: 'C:\\Windows\\cmd.exe' }),
    ['C:\\Windows\\cmd.exe', ['/d', '/s', '/c', '"echo hi"'], true],
  );
});
