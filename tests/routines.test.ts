import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileService } from '../src/host/files';
import { YourAiService } from '../src/host/you';
import { WorkspaceService } from '../src/host/workspaces';
import { SettingsService } from '../src/host/settings';
import { GitService } from '../src/git/service';
import { AgentService } from '../src/agents/service';
import { SessionStore } from '../src/agents/sessions';
import { failedReport, nothingToDo, parseRoutine, RoutineService } from '../src/host/routines';
import { lineDiff, type RoutineRef, type RoutineRun } from '../src/domain/routines';
import type { AgentEvent } from '../src/domain/types';

const fixtureOptions = {
  skip: process.platform === 'win32' && 'POSIX executable fixture',
  timeout: 30000,
};
const until = async (check: () => boolean | Promise<boolean>, what: string) => {
  for (let n = 0; n < 1000; n++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error(`Timed out waiting for ${what}`);
};

test('routine.yaml is read strictly, with one-sentence reasons', () => {
  const good = parseRoutine(
    `name: Mail triage
steps:
  - run: fetch.js
  - run: [gh, api, user]
    secrets: [GH_TOKEN]
  - agent: irori
    hibachis: all
    access: full-access
    cli: claude
    prompt: |
      Put each mail in $IRORI_WORK into the hibachi it concerns.
`,
    'irori',
  );
  assert.ok('steps' in good, JSON.stringify(good));
  assert.equal(good.name, 'Mail triage');
  assert.deepEqual(good.steps[0], { kind: 'run', run: 'fetch.js' });
  assert.deepEqual(good.steps[1], {
    kind: 'run',
    run: ['gh', 'api', 'user'],
    secrets: ['GH_TOKEN'],
  });
  assert.equal(good.steps[2].kind === 'agent' && good.steps[2].hibachis, 'all');
  const problem = (text: string, owner: 'irori' | 'hibachi' = 'hibachi') => {
    const result = parseRoutine(text, owner);
    assert.ok('problem' in result, `accepted: ${text}`);
    return result.problem;
  };
  assert.match(problem('name: [unclosed\n'), /routine\.yaml を読めません（2 行目）/);
  assert.match(problem('name: A\nname: B\nsteps: [{run: a.js}]\n'), /routine\.yaml を読めません/);
  assert.match(problem('name: A\nwhen: "0 8 * * *"\nsteps: [{run: a.js}]\n'), /不明なキー.*when/);
  assert.match(problem('steps: [{run: a.js}]\n'), /name がありません/);
  assert.match(problem('name: A\nsteps: []\n'), /steps が正しくありません/);
  assert.match(
    problem('name: A\nsteps: [{run: a.js, agent: hibachi}]\n'),
    /ステップ 1 には run か agent/,
  );
  assert.match(
    problem('name: A\nsteps: [{run: a.js}, {agent: hibachi, prompt: go}]\n'),
    /ステップ 2 の access がありません/,
  );
  assert.match(
    problem('name: A\nsteps: [{agent: hibachi, access: everything, prompt: go}]\n'),
    /access は default \/ full-access のどれか/,
  );
  assert.match(
    problem('name: A\nsteps: [{agent: hibachi, access: default, promt: go}]\n'),
    /ステップ 1 に不明なキー.*promt/,
  );
  for (const run of [
    '../outside.js',
    '/etc/passwd',
    'a\\\\b.js',
    'C:/x.js',
    '[../bin/tool]',
    '[-rf]',
  ])
    assert.match(
      problem(`name: A\nsteps: [{run: ${run}}]\n`),
      /ステップ 1 の run が正しくありません/,
    );
  assert.match(
    problem('name: A\nsteps: [{agent: irori, access: default, prompt: go}]\n'),
    /hibachi のルーティンでは agent: hibachi/,
  );
  assert.match(
    problem('name: A\nsteps: [{agent: hibachi, access: default, prompt: go}]\n', 'irori'),
    /irori agent のルーティンでは agent: irori/,
  );
  assert.match(
    problem('name: A\nsteps: [{agent: hibachi, hibachis: all, access: default, prompt: go}]\n'),
    /hibachis は agent: irori/,
  );
  assert.match(
    problem('name: A\nsteps: [{agent: hibachi, cli: pi, access: full-access, prompt: go}]\n'),
    /Pi はこのアクセス設定に対応していません/,
  );
  assert.match(
    problem('name: A\nsteps: [{agent: hibachi, access: default, prompt: "  "}]\n'),
    /prompt が正しくありません/,
  );
});

test('the gate, the failure marker and the review difference are read exactly', () => {
  assert.equal(nothingToDo('fetched 0\n{"continue": false}\n'), true);
  assert.equal(nothingToDo('{"continue":false}\r\n'), true);
  assert.equal(nothingToDo('{"continue": false}\nfetched 3\n'), false);
  assert.equal(nothingToDo('{"continue": true}'), false);
  assert.equal(nothingToDo('{"continue": "false"}'), false);
  assert.equal(
    failedReport('[FAILED] Two mails had no hibachi.\nDetails…'),
    'Two mails had no hibachi.',
  );
  assert.equal(failedReport('Done. [FAILED] appears later'), undefined);
  assert.deepEqual(lineDiff('a\nb\nc\nd\ne\nf\ng\nh\ni\n', 'a\nb\nc\nd\nE\nf\ng\nh\ni\n', 1), [
    { kind: '…', text: '' },
    { kind: ' ', text: 'd' },
    { kind: '-', text: 'e' },
    { kind: '+', text: 'E' },
    { kind: ' ', text: 'f' },
    { kind: '…', text: '' },
  ]);
  assert.deepEqual(lineDiff('x\n', 'x\ny\n'), [
    { kind: ' ', text: 'x' },
    { kind: '+', text: 'y' },
    { kind: ' ', text: '' },
  ]);
});

async function setup(t: TestContext, { javascript = true } = {}) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori routines '));
  const bin = path.join(base, 'bin');
  await mkdir(bin);
  await writeFile(
    path.join(bin, 'pi'),
    `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(path.resolve('tests/fixtures/harnesses.mjs')).href)}).then(m=>m.run('pi'));\n`,
    { mode: 0o700 },
  );
  const oldPath = process.env.PATH;
  process.env.PATH = bin + path.delimiter + oldPath;
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const root = path.join(base, 'Product 日本語');
  await mkdir(root);
  await writeFile(path.join(root, 'note.md'), '# Product\n');
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args],
      {
        cwd: root,
        stdio: 'pipe',
      },
    );
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'Start');
  const space = await files.register(root, 'Product', 'team');
  const you = new YourAiService(files.dataDir, path.join(base, 'home'));
  await you.load();
  await you.create();
  const { id: youId, root: youRoot } = await you.load();
  const events: AgentEvent[] = [];
  const agents = new AgentService(files, (event) => events.push(event), undefined, undefined, you);
  const workspaces = new WorkspaceService(files);
  const workspace = await workspaces.save('Lab', [space.scopeId]);
  const settings = new SettingsService(files.dataDir);
  if (javascript) await settings.save({ routineRuntimes: ['javascript'] });
  const gitService = new GitService(files);
  const emitted: RoutineRun[] = [];
  const host = {
    dataDir: files.dataDir,
    files,
    you,
    agents,
    workspaces: () => workspaces.list(),
    settings: () => settings.read(),
    gitStatus: (id: string) => gitService.status(id),
    canStart: () => {},
    emit: (run: RoutineRun) => emitted.push(structuredClone(run)),
  };
  const routines = new RoutineService(host);
  await routines.init();
  t.after(async () => {
    await routines.stopAll();
    await agents.cancel();
    process.env.PATH = oldPath;
    await rm(base, { recursive: true, force: true });
  });
  /** Writes a routine folder in the hibachi or the irori agent's folder. */
  const routine = async (
    folder: string,
    contents: Record<string, string>,
    owner: 'hibachi' | 'irori' = 'hibachi',
  ): Promise<RoutineRef> => {
    const dir =
      owner === 'hibachi'
        ? path.join(root, '.irori', 'routines', folder)
        : path.join(youRoot, 'routines', folder);
    for (const [rel, text] of Object.entries(contents)) {
      await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await writeFile(path.join(dir, rel), text, { mode: rel.endsWith('.sh') ? 0o700 : 0o600 });
    }
    return { owner: owner === 'hibachi' ? space.scopeId : youId, folder };
  };
  const listed = async (ref: RoutineRef) =>
    (await routines.list(workspace.id)).find(
      (item) => item.ref.owner === ref.owner && item.ref.folder === ref.folder,
    )!;
  /** Starts a run as the view does: review, then run with the reviewed digest. */
  const start = async (ref: RoutineRef, agentsChoice = {}) => {
    const review = await routines.review(ref);
    return routines.run(ref, {
      workspaceId: workspace.id,
      digest: review.digest,
      agents: agentsChoice,
    });
  };
  const ended = async (ref: RoutineRef, id: string) => {
    await until(async () => !routines.busy, 'the routine to end');
    const run = (await routines.runs(ref)).find((item) => item.id === id)!;
    assert.ok(run.endedAt, JSON.stringify(run));
    return run;
  };
  return {
    base,
    youId,
    root,
    space,
    you,
    youRoot,
    files,
    agents,
    events,
    workspace,
    settings,
    routines,
    host,
    emitted,
    routine,
    listed,
    start,
    ended,
    git,
  };
}

const fetchJs = `const fs = require('node:fs');
const path = require('node:path');
const count = path.join(process.env.IRORI_STATE, 'count');
const n = (fs.existsSync(count) ? Number(fs.readFileSync(count, 'utf8')) : 0) + 1;
fs.writeFileSync(count, String(n));
fs.writeFileSync(path.join(process.env.IRORI_WORK, 'items.txt'), 'first\\nsecond\\n');
console.log('fetched 2 in ' + path.basename(process.cwd()) + ', run ' + n);
console.log('routine ' + path.basename(process.env.IRORI_ROUTINE));
`;
const placeJs = `const fs = require('node:fs');
const path = require('node:path');
const items = fs.readFileSync(path.join(process.env.IRORI_WORK, 'items.txt'), 'utf8');
fs.mkdirSync('inbox', { recursive: true });
fs.writeFileSync(path.join('inbox', 'items.md'), items);
console.error('placed');
`;

test(
  'a routine runs only as reviewed: steps in order, a shared work folder, kept state and a new review after a change',
  fixtureOptions,
  async (t) => {
    const { routines, routine, listed, start, ended, workspace, root, base, files } =
      await setup(t);
    const ref = await routine('collect', {
      'routine.yaml': 'name: Collect\nsteps:\n  - run: fetch.js\n  - run: place.js\n',
      'fetch.js': fetchJs,
      'place.js': placeJs,
      '.DS_Store': 'finder',
    });
    const first = await listed(ref);
    assert.equal(first.name, 'Collect');
    assert.equal(first.owner, 'hibachi');
    assert.equal(first.review, 'unreviewed');
    assert.equal(first.problem, undefined);
    assert.equal(first.needs, undefined);
    await assert.rejects(
      routines.run(ref, { workspaceId: workspace.id, agents: {} }),
      /ルーティンを確認してから実行してください/,
    );
    const review = await routines.review(ref);
    assert.equal(review.confirmedBefore, false);
    assert.deepEqual(
      review.files.map((file) => [file.path, file.status]),
      [
        ['routine.yaml', 'added'],
        ['fetch.js', 'added'],
        ['place.js', 'added'],
      ],
    );
    assert.equal(review.files[1].text, fetchJs);
    const id = await routines.run(ref, {
      workspaceId: workspace.id,
      digest: review.digest,
      agents: {},
    });
    await assert.rejects(start(ref), /実行中/);
    const run = await ended(ref, id);
    assert.equal(run.state, 'succeeded', JSON.stringify(run));
    assert.deepEqual(
      run.steps.map((step) => [step.label, step.state, step.exitCode]),
      [
        ['fetch.js', 'succeeded', 0],
        ['place.js', 'succeeded', 0],
      ],
    );
    assert.match(run.steps[0].output, /fetched 2 in Product 日本語, run 1\nroutine collect\n/);
    assert.equal(run.steps[1].output, 'placed\n');
    assert.equal(await readFile(path.join(root, 'inbox', 'items.md'), 'utf8'), 'first\nsecond\n');
    // The run's work folder is gone once its record is kept.
    assert.deepEqual(await readdir(path.join(files.dataDir, 'routines', 'work')), []);
    assert.equal((await listed(ref)).review, 'reviewed');
    assert.equal((await listed(ref)).last?.state, 'succeeded');

    // A second run needs no review; IRORI_STATE is kept for the routine.
    const again = await ended(
      ref,
      await routines.run(ref, { workspaceId: workspace.id, agents: {} }),
    );
    assert.match(again.steps[0].output, /run 2/);
    assert.deepEqual(
      (await routines.runs(ref)).map((item) => item.id),
      [again.id, id],
    );

    // Any change, here to one file, brings the review back with the difference.
    const edited = fetchJs.replace('fetched 2', 'fetched two');
    await writeFile(path.join(root, '.irori', 'routines', 'collect', 'fetch.js'), edited);
    assert.equal((await listed(ref)).review, 'changed');
    await assert.rejects(
      routines.run(ref, { workspaceId: workspace.id, digest: review.digest, agents: {} }),
      /ルーティンが変わりました/,
    );
    const changed = await routines.review(ref);
    assert.equal(changed.confirmedBefore, true);
    assert.deepEqual(
      changed.files.map((file) => [file.path, file.status]),
      [
        ['routine.yaml', 'same'],
        ['fetch.js', 'changed'],
        ['place.js', 'same'],
      ],
    );
    assert.ok(
      changed.files[1].diff?.some((line) => line.kind === '+' && line.text.includes('fetched two')),
    );
    assert.ok(
      changed.files[1].diff?.some((line) => line.kind === '-' && line.text.includes('fetched 2')),
    );
    await writeFile(path.join(root, '.irori', 'routines', 'collect', 'extra.txt'), 'new');
    const added = await routines.review(ref);
    assert.equal(added.files.find((file) => file.path === 'extra.txt')?.status, 'added');
    const third = await ended(ref, await start(ref));
    assert.equal(third.state, 'succeeded');
    assert.match(third.steps[0].output, /fetched two/);
    assert.equal((await listed(ref)).review, 'reviewed');

    // A link inside the folder, or a missing file, makes the routine invalid.
    await symlink(
      path.join(base, 'bin'),
      path.join(root, '.irori', 'routines', 'collect', 'tools'),
    );
    assert.match((await listed(ref)).problem ?? '', /リンクは使えません: tools/);
    await assert.rejects(start(ref), /リンクは使えません/);
    await rm(path.join(root, '.irori', 'routines', 'collect', 'tools'));
    await rm(path.join(root, '.irori', 'routines', 'collect', 'place.js'));
    assert.match((await listed(ref)).problem ?? '', /place\.js がありません/);
  },
);

test(
  'the nothing-to-do gate ends quietly, a failing step stops the run and 停止 ends the step in progress',
  fixtureOptions,
  async (t) => {
    const { routines, routine, start, ended, root, files } = await setup(t);
    const later = `require('node:fs').writeFileSync('later-ran', 'yes');\n`;
    const quiet = await routine('quiet', {
      'routine.yaml': 'name: Quiet\nsteps:\n  - run: check.js\n  - run: later.js\n',
      'check.js': `console.log('no new mail');\nconsole.log(JSON.stringify({ continue: false }));\n`,
      'later.js': later,
    });
    const nothing = await ended(quiet, await start(quiet));
    assert.equal(nothing.state, 'nothing');
    assert.deepEqual(
      nothing.steps.map((step) => step.state),
      ['succeeded', 'pending'],
    );
    assert.equal(existsSync(path.join(root, 'later-ran')), false);

    const failing = await routine('failing', {
      'routine.yaml': 'name: Failing\nsteps:\n  - run: fail.js\n  - run: later.js\n',
      'fail.js': `console.error('token expired');\nprocess.exit(3);\n`,
      'later.js': later,
    });
    const failed = await ended(failing, await start(failing));
    assert.equal(failed.state, 'failed');
    assert.equal(failed.steps[0].state, 'failed');
    assert.equal(failed.steps[0].exitCode, 3);
    assert.equal(failed.steps[0].detail, '終了コード 3');
    assert.equal(failed.steps[0].output, 'token expired\n');
    assert.equal(failed.steps[1].state, 'pending');
    assert.equal(existsSync(path.join(root, 'later-ran')), false);

    const long = await routine('long', {
      'routine.yaml': 'name: Long\nsteps:\n  - run: wait.js\n  - run: later.js\n',
      'wait.js': `require('node:fs').writeFileSync(require('node:path').join(process.env.IRORI_STATE, 'pid'), String(process.pid));\nconsole.log('waiting');\nsetTimeout(() => {}, 60000);\n`,
      'later.js': later,
    });
    const id = await start(long);
    await until(
      async () => (await routines.runs(long))[0]?.steps[0].output.includes('waiting'),
      'the step to print',
    );
    await routines.stop(long);
    const stopped = await ended(long, id);
    assert.equal(stopped.state, 'stopped');
    assert.deepEqual(
      stopped.steps.map((step) => step.state),
      ['stopped', 'pending'],
    );
    assert.equal(existsSync(path.join(root, 'later-ran')), false);
    // The program was ended, not left running.
    const kept = path.join(files.dataDir, 'routines', 'state');
    const pids: number[] = [];
    for (const dir of await readdir(kept))
      if (existsSync(path.join(kept, dir, 'pid')))
        pids.push(Number(await readFile(path.join(kept, dir, 'pid'), 'utf8')));
    assert.equal(pids.length, 1);
    assert.throws(() => process.kill(pids[0], 0), /ESRCH/);
  },
);

test(
  'what a device lacks is named before a run: JavaScript, Python, secrets and PATH commands',
  fixtureOptions,
  async (t) => {
    const { routine, listed, start, ended, settings } = await setup(t, { javascript: false });
    const js = await routine('js', {
      'routine.yaml': 'name: JS\nsteps: [{run: a.mjs}]\n',
      'a.mjs': 'console.log("ok");\n',
    });
    assert.deepEqual((await listed(js)).needs, {
      text: 'JavaScript が必要です。',
      runtime: 'javascript',
    });
    await assert.rejects(start(js), /JavaScript が必要です/);
    await settings.save({ routineRuntimes: ['javascript'] });
    assert.equal((await listed(js)).needs, undefined);
    assert.equal((await ended(js, await start(js))).steps[0].output, 'ok\n');
    const py = await routine('py', {
      'routine.yaml': 'name: Py\nsteps: [{run: fetch.py}]\n',
      'fetch.py': 'print(1)\n',
    });
    assert.equal((await listed(py)).needs?.text, 'Python はまだ使えません。');
    const secret = await routine('secret', {
      'routine.yaml': 'name: S\nsteps: [{run: [echo, hi], secrets: [TOKEN]}]\n',
    });
    assert.equal((await listed(secret)).needs?.text, 'シークレットはまだ使えません。');
    const missing = await routine('missing', {
      'routine.yaml': 'name: M\nsteps: [{run: [irori-no-such-command, x]}]\n',
    });
    assert.equal((await listed(missing)).needs?.text, 'irori-no-such-command が見つかりません。');
    // A command on PATH and a program with its own #! line run in the working folder.
    const programs = await routine('programs', {
      'routine.yaml':
        'name: P\nsteps:\n  - run: [git, rev-parse, --abbrev-ref, HEAD]\n  - run: hello.sh\n',
      'hello.sh': '#!/bin/sh\necho "hello from $(basename "$PWD")"\n',
    });
    const run = await ended(programs, await start(programs));
    assert.equal(run.state, 'succeeded', JSON.stringify(run));
    assert.equal(run.steps[0].output, 'main\n');
    assert.equal(run.steps[1].output, 'hello from Product 日本語\n');
    const plain = await routine('plain', {
      'routine.yaml': 'name: Plain\nsteps: [{run: tool}]\n',
      tool: '#!/bin/sh\necho x\n',
    });
    assert.match((await listed(plain)).problem ?? '', /tool に実行権限がありません/);
  },
);

test('a run records the files each hibachi Git status shows changed', fixtureOptions, async (t) => {
  const { routine, start, ended, root, space } = await setup(t);
  await writeFile(path.join(root, 'note.md'), '# Product\nEdited before the run.\n');
  await writeFile(path.join(root, 'draft.md'), 'Untouched.\n');
  const ref = await routine('write', {
    'routine.yaml': 'name: Write\nsteps: [{run: write.js}]\n',
    'write.js': `const fs = require('node:fs');\nfs.appendFileSync('note.md', 'Added by the routine.\\n');\nfs.mkdirSync('inbox', { recursive: true });\nfs.writeFileSync('inbox/new.md', 'New.\\n');\n`,
  });
  const run = await ended(ref, await start(ref));
  assert.equal(run.state, 'succeeded', JSON.stringify(run));
  assert.deepEqual(run.changes, [
    { scopeId: space.scopeId, name: 'Product', paths: ['inbox/new.md', 'note.md'] },
  ]);
});

test(
  'an agent step is an ordinary run in a fresh session, with the preamble, the variables and its report',
  fixtureOptions,
  async (t) => {
    const { routine, start, ended, root, space, agents, files } = await setup(t);
    // The person's own saved session with that CLI stays as it was.
    const sessions = new SessionStore(files.dataDir);
    const binding = { scopeId: space.scopeId, agent: 'pi' as const, root: space.root };
    await sessions.save(binding, path.join(root, 'person-session.jsonl'), 'default');
    const ref = await routine('ask', {
      'routine.yaml':
        'name: Ask\nsteps:\n  - agent: hibachi\n    access: default\n    prompt: Summarize the inbox.\n',
    });
    // Without `cli` the step uses the CLI chosen in the hibachi agent's panel.
    const run = await ended(ref, await start(ref, { [space.scopeId]: { agent: 'pi' } }));
    assert.equal(run.state, 'succeeded', JSON.stringify(run));
    const step = run.steps[0];
    assert.equal(step.label, 'hibachi agent');
    assert.equal(step.output, '日本語 の応答');
    assert.equal(step.conversation?.scopeId, space.scopeId);
    assert.equal(step.conversation?.agent, 'pi');
    assert.equal((await sessions.read(binding))?.handle, path.join(root, 'person-session.jsonl'));
    // The conversation shows the step's prompt and the routine, not the preamble.
    const shown = (await agents.conversation(space.scopeId, 'pi')).events.filter(
      (event) => event.runId === step.conversation?.runId,
    );
    assert.ok(
      shown.some((event) => event.role === 'user' && event.text === 'Summarize the inbox.'),
    );
    assert.ok(shown.some((event) => event.text === 'ルーティン: Ask（ステップ 1）'));
    assert.ok(!shown.some((event) => event.text.includes('IRORI_WORK=')));
    const requests = (await readFile(path.join(root, 'fixture-requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.ok(!requests.find((request) => request.type === 'launch').args.includes('--session'));
    const prompt: string = requests.find((request) => request.type === 'prompt').message;
    assert.match(prompt, /step of the routine "Ask"/);
    assert.match(prompt, /IRORI_WORK=.+\nIRORI_STATE=.+\nIRORI_ROUTINE=.+ask \(/);
    assert.match(prompt, /begin the report with \[FAILED\]/);
    assert.ok(prompt.endsWith('Summarize the inbox.'));

    // A report beginning with [FAILED] fails the step although the CLI ended normally.
    const failing = await routine('fails', {
      'routine.yaml':
        'name: Fails\nsteps:\n  - agent: hibachi\n    cli: pi\n    access: default\n    prompt: |\n      run: echo "[FAILED] Two mails had no hibachi."\n  - run: [git, status]\n',
    });
    const failed = await ended(failing, await start(failing));
    assert.equal(failed.state, 'failed');
    assert.equal(failed.steps[0].state, 'failed');
    assert.equal(failed.steps[0].detail, 'Two mails had no hibachi.');
    assert.equal(failed.steps[1].state, 'pending');
    // The variables are in the CLI's environment too.
    const variables = await routine('variables', {
      'routine.yaml':
        'name: Variables\nsteps:\n  - agent: hibachi\n    cli: pi\n    access: default\n    prompt: |\n      run: printf "%s" "$IRORI_ROUTINE"\n',
    });
    const read = await ended(variables, await start(variables));
    assert.equal(read.steps[0].output, path.join(root, '.irori', 'routines', 'variables'));
  },
);

test(
  'an agent step waits while its hibachi is held, and 停止 ends it',
  fixtureOptions,
  async (t) => {
    const { routine, start, ended, routines, space, agents } = await setup(t);
    // The person's own run holds the hibachi.
    agents.start({ scopeId: space.scopeId, agent: 'pi', prompt: 'hold' });
    const ref = await routine('after', {
      'routine.yaml':
        'name: After\nsteps:\n  - agent: hibachi\n    cli: pi\n    access: default\n    prompt: Summarize.\n',
    });
    const id = await start(ref);
    await until(
      async () => (await routines.runs(ref))[0]?.steps[0].state === 'waiting',
      'the step to wait',
    );
    assert.equal((await routines.runs(ref))[0].steps[0].detail, 'Product の実行待ち');
    await agents.cancel(space.scopeId);
    assert.equal((await ended(ref, id)).state, 'succeeded');

    const hold = await routine('hold', {
      'routine.yaml':
        'name: Holding\nsteps:\n  - agent: hibachi\n    cli: pi\n    access: default\n    prompt: hold\n  - run: [git, status]\n',
    });
    const second = await start(hold);
    await until(
      async () =>
        (await routines.runs(hold))[0]?.steps[0].state === 'running' && agents.busy(space.scopeId),
      'the agent to start',
    );
    await routines.stop(hold);
    const stopped = await ended(hold, second);
    assert.equal(stopped.state, 'stopped');
    assert.deepEqual(
      stopped.steps.map((step) => step.state),
      ['stopped', 'pending'],
    );
    assert.equal(agents.busy(space.scopeId), false);
  },
);

test(
  'an irori agent routine hands the named hibachis of the workspace to the irori agent',
  fixtureOptions,
  async (t) => {
    const { routine, listed, start, ended, youId, youRoot } = await setup(t);
    const elsewhere = await routine(
      'elsewhere',
      {
        'routine.yaml':
          'name: Elsewhere\nsteps:\n  - agent: irori\n    hibachis: [Research]\n    access: default\n    prompt: Sort.\n',
      },
      'irori',
    );
    assert.equal(
      (await listed(elsewhere)).needs?.text,
      'hibachi「Research」はこのワークスペースにありません。',
    );
    const ref = await routine(
      'sort',
      {
        'routine.yaml':
          'name: Sort\nsteps:\n  - agent: irori\n    hibachis: [Product]\n    cli: pi\n    access: default\n    prompt: Sort the mail.\n',
      },
      'irori',
    );
    const found = await listed(ref);
    assert.equal(found.owner, 'irori');
    assert.equal(found.path, path.join(youRoot, 'routines', 'sort'));
    const run = await ended(ref, await start(ref));
    assert.equal(run.state, 'succeeded', JSON.stringify(run));
    assert.equal(run.steps[0].label, 'irori agent');
    assert.equal(run.steps[0].conversation?.scopeId, youId);
    const requests = (await readFile(path.join(youRoot, 'fixture-requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const prompt: string = requests.find((request) => request.type === 'prompt').message;
    // The hibachis handed to it come first, then the routine's words, then the step.
    assert.match(
      prompt,
      /- Product \(.+\): folder .+, hibachi agent "hibachi-product"[\s\S]*step of the routine "Sort"[\s\S]*Sort the mail\.$/,
    );
  },
);

test(
  'a run left running by an exit or a crash is marked unknown and never repeated',
  fixtureOptions,
  async (t) => {
    const { routine, start, routines, host, files } = await setup(t);
    const ref = await routine('long', {
      'routine.yaml': 'name: Long\nsteps:\n  - run: wait.js\n',
      'wait.js': 'console.log("waiting");\nsetTimeout(() => {}, 60000);\n',
    });
    const id = await start(ref);
    await until(
      async () => !!(await routines.runs(ref))[0]?.steps[0].output.includes('waiting'),
      'the step to print',
    );
    // The next irori over the same data directory, as after a crash.
    await mkdir(path.join(files.dataDir, 'routines', 'work', 'left-behind'), { recursive: true });
    const next = new RoutineService(host);
    await next.init();
    const [run] = await next.runs(ref);
    assert.equal(run.id, id);
    assert.equal(run.state, 'unknown');
    assert.equal(run.steps[0].state, 'unknown');
    assert.equal(next.busy, false);
    assert.equal(existsSync(path.join(files.dataDir, 'routines', 'work', 'left-behind')), false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal((await next.runs(ref)).length, 1);
  },
);
