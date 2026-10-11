import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentService } from '../src/agents/service';
import { AttachmentStore } from '../src/agents/attachments';
import { FileService } from '../src/host/files';
import { attachmentName, attachmentImageType } from '../src/domain/attachments';
import {
  elicitationContent,
  elicitationQuestions,
  questionsAnswered,
} from '../src/domain/questions';
import { hostArguments } from '../src/domain/host-requests';
import type { AgentEvent } from '../src/domain/types';

const fixture = {
  skip: process.platform === 'win32' && 'POSIX executable fixture',
  timeout: 20000,
};
// A one-pixel PNG.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('Attached files are kept by id under a safe name and live as long as their conversation', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'irori attachments '));
  t.after(() => rm(base, { recursive: true, force: true }));
  const store = new AttachmentStore(base);
  assert.equal(attachmentName('../../etc/pass:wd'), 'pass_wd');
  assert.equal(attachmentName('.hidden'), 'hidden');
  assert.equal(attachmentImageType('Shot.PNG'), 'image/png');
  assert.equal(attachmentImageType('notes.pdf'), undefined);

  const image = await store.stage('../shot.png', png);
  assert.equal(image.name, 'shot.png');
  assert.equal(path.dirname(await store.path(image)), path.join(base, 'attachments', image.id));
  assert.deepEqual(await store.image(image.id), new Uint8Array(png));
  const text = await store.stage('notes.txt', Buffer.from('hello'));
  assert.equal(await store.image(text.id), null, 'only images come back as pictures');
  await assert.rejects(
    store.path({ id: text.id, name: 'other.txt' }),
    /not on this device|この端末/,
  );
  await assert.rejects(store.path({ id: '../x', name: 'notes.txt' }));
  await assert.rejects(store.stage('big.bin', new Uint8Array(25 * 1024 * 1024 + 1)), /25 MB/);

  // A sent file stays when the person would discard it; an unsent one goes.
  await store.claim([image], 'c0000000-0000-4000-8000-000000000001');
  await store.discard(image.id);
  await store.discard(text.id);
  assert.deepEqual(await readdir(store.root), [image.id]);

  // Unsent files are pruned after a day; sent ones only with their conversation.
  const stale = await store.stage('old.txt', Buffer.from('old'));
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await utimes(path.join(store.root, stale.id), old, old);
  await utimes(path.join(store.root, image.id), old, old);
  await store.prune();
  assert.deepEqual(await readdir(store.root), [image.id]);
  await store.removeConversation('c0000000-0000-4000-8000-000000000001');
  assert.deepEqual(await readdir(store.root), []);
});

test('The host boundary takes attachment bytes up to the limit and well-formed references', () => {
  assert.ok(hostArguments.stageAttachment.safeParse(['a.png', new Uint8Array(4)]).success);
  assert.equal(
    hostArguments.stageAttachment.safeParse(['a.png', new Uint8Array(25 * 1024 * 1024 + 1)])
      .success,
    false,
  );
  const ref = { id: '0b8f7c7e-2a8f-4d4c-9b7e-111111111111', name: 'a.png', size: 4 };
  const start = {
    scopeId: '0b8f7c7e-2a8f-4d4c-9b7e-222222222222',
    agent: 'codex',
    prompt: 'look',
  };
  assert.ok(hostArguments.start.safeParse([{ ...start, attachments: [ref] }]).success);
  assert.equal(
    hostArguments.start.safeParse([{ ...start, attachments: [{ ...ref, name: '../a.png' }] }])
      .success,
    false,
    'a name with folders is refused',
  );
  assert.equal(
    hostArguments.start.safeParse([{ ...start, attachments: Array(11).fill(ref) }]).success,
    false,
  );
});

test('An MCP form becomes questions, and the answers go back typed as the form asks', () => {
  const schema = {
    type: 'object',
    required: ['color', 'count'],
    properties: {
      color: {
        type: 'string',
        title: 'Color',
        oneOf: [
          { const: 'r', title: 'Red' },
          { const: 'g', title: 'Green' },
        ],
      },
      tags: { type: 'array', items: { enum: ['a', 'b'] } },
      count: { type: 'integer', description: 'How many' },
      agree: { type: 'boolean', title: 'Agree' },
      legacy: { type: 'string', enum: ['x', 'y'], enumNames: ['Ex', 'Why'] },
    },
  };
  const questions = elicitationQuestions(schema);
  assert.deepEqual(
    questions.map((q) => [q.id, q.options?.map((o) => o.label), !!q.multiple, !!q.optional]),
    [
      ['color', ['Red', 'Green'], false, false],
      ['tags', ['a', 'b'], true, true],
      ['count', undefined, false, false],
      ['agree', [questions[3].options![0].label, questions[3].options![1].label], false, true],
      ['legacy', ['Ex', 'Why'], false, true],
    ],
  );
  assert.equal(questions[2].other, true, 'a number is typed');
  const answers = {
    color: 'Green',
    tags: ['b'],
    count: '3',
    agree: questions[3].options![0].label,
    legacy: 'Why',
  };
  assert.equal(questionsAnswered(questions, { color: 'Red' }), false);
  assert.equal(questionsAnswered(questions, { color: 'Red', count: '1' }), true);
  assert.deepEqual(elicitationContent(schema, answers), {
    color: 'g',
    tags: ['b'],
    count: 3,
    agree: true,
    legacy: 'y',
  });
});

async function setup(t: any, cli: string, script: string) {
  const base = await mkdtemp(path.join(tmpdir(), 'irori chat fixture '));
  const previous = process.env.PATH;
  t.after(async () => {
    process.env.PATH = previous;
    await rm(base, { recursive: true, force: true });
  });
  const bin = path.join(base, 'bin');
  const root = path.join(base, 'KB');
  await mkdir(bin);
  await mkdir(root);
  await writeFile(path.join(bin, cli), script, { mode: 0o700 });
  process.env.PATH = bin + path.delimiter + previous;
  const files = new FileService(path.join(base, 'device'));
  await files.init();
  const space = await files.register(root, 'KB', 'personal');
  return { base, root, files, space };
}

// Codex's app server, played without a model: it records the turn's input, asks
// a question and an MCP form, and records the answers it gets back.
const codexFixture = `#!/usr/bin/env node
const fs = require('node:fs');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const log = value => fs.appendFileSync('codex-log.jsonl', JSON.stringify(value) + '\\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (m.id !== undefined && !m.method) {
    log({answer: m.id, result: m.result});
    if (m.id === 'question') send({id:'form',method:'mcpServer/elicitation/request',params:{serverName:'fixture',threadId:'t',message:'Pick a size',mode:'form',requestedSchema:{type:'object',required:['size'],properties:{size:{type:'string',enum:['S','M']}}}}});
    else send({method:'turn/completed',params:{turn:{status:'completed'}}});
    return;
  }
  if (!m.method || m.id === undefined) return;
  const result = m.method.startsWith('thread/') ? {thread:{id:'fixture-thread'}}
    : m.method === 'turn/start' ? {turn:{id:'fixture-turn'}} : {};
  send({id:m.id,result});
  if (m.method !== 'turn/start') return;
  log({input: m.params.input});
  send({id:'question',method:'item/tool/requestUserInput',params:{threadId:'t',turnId:'fixture-turn',itemId:'i',isBlocking:true,questions:[{id:'q1',header:'Color',question:'Which color?',isOther:true,isSecret:false,options:[{label:'Red',description:'Warm'},{label:'Green',description:'Calm'}]}]}});
});
`;

test(
  'Codex is shown attached images and asked questions with headers, descriptions and forms',
  fixture,
  async (t) => {
    const { base, root, files, space } = await setup(t, 'codex', codexFixture);
    const events: AgentEvent[] = [];
    let done!: () => void;
    const completed = new Promise<void>((resolve) => {
      done = resolve;
    });
    const service = new AgentService(files, (event) => {
      events.push(event);
      if (event.type === 'question' && event.questions?.[0].id === 'q1')
        void service.respond(event.requestId!, true, { q1: 'Purple' });
      else if (event.type === 'question')
        void service.respond(event.requestId!, true, { size: 'M' });
      if (event.type === 'done') done();
    });
    t.after(() => service.cancel());
    const image = await service.attachments.stage('shot.png', png);
    const notes = await service.attachments.stage('notes.txt', Buffer.from('words'));
    service.start({
      scopeId: space.scopeId,
      agent: 'codex',
      prompt: 'What is in these?',
      attachments: [image, notes],
    });
    await completed;
    assert.equal(events.at(-1)?.outcome, 'completed', JSON.stringify(events.slice(-3)));
    const log = (await readFile(path.join(root, 'codex-log.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const input = log[0].input;
    const imagePath = path.join(base, 'device', 'attachments', image.id, 'shot.png');
    assert.deepEqual(input[0], { type: 'localImage', path: imagePath });
    assert.equal(input.length, 2, 'only the image goes as a picture');
    assert.ok(input[1].text.includes(JSON.stringify(imagePath)));
    assert.ok(
      input[1].text.includes(
        JSON.stringify(path.join(base, 'device', 'attachments', notes.id, 'notes.txt')),
      ),
    );
    assert.ok(input[1].text.endsWith('What is in these?'), 'the person’s words stay last');

    const [question, form] = events.filter((event) => event.type === 'question');
    assert.deepEqual(question.questions, [
      {
        id: 'q1',
        title: 'Which color?',
        header: 'Color',
        options: [
          { label: 'Red', description: 'Warm' },
          { label: 'Green', description: 'Calm' },
        ],
        other: true,
      },
    ]);
    assert.equal(form.text, 'Pick a size');
    assert.deepEqual(form.questions?.[0].options, [{ label: 'S' }, { label: 'M' }]);
    assert.deepEqual(log[1].result, { answers: { q1: { answers: ['Purple'] } } });
    assert.deepEqual(log[2].result, { action: 'accept', content: { size: 'M' } });

    // The person's message keeps its files, in the view and in the history.
    const sent = events.find((event) => event.role === 'user')!;
    assert.deepEqual(sent.attachments, [image, notes]);
    const saved = await service.conversation(space.scopeId, 'codex');
    assert.deepEqual(saved.events.find((event) => event.role === 'user')?.attachments, [
      image,
      notes,
    ]);
    // Deleting the conversation deletes its files.
    await service.deleteConversation(saved.id!);
    assert.deepEqual(await readdir(service.attachments.root), []);
  },
);

// Claude Code's stream-json, played without a model: it records the arguments
// and the person's message, asks an AskUserQuestion and records the answer.
const claudeFixture = `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync('arguments.json', JSON.stringify(process.argv.slice(2)));
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const timer = setTimeout(() => process.exit(2), 8000);
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  if (message.type === 'control_request')
    send({type:'control_response',response:{subtype:'success',request_id:message.request_id,response:{}}});
  if (message.type === 'user') {
    fs.writeFileSync('message.json', JSON.stringify(message.message));
    send({type:'system',subtype:'init',session_id:'fixture-session'});
    send({type:'control_request',request_id:'ask',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',tool_use_id:'tool',input:{questions:[{question:'Which plan?',header:'Plan',multiSelect:false,options:[{label:'Small',description:'Fewer files'},{label:'Large',description:'More files',preview:'+ a\\n+ b'}]}]}}});
  }
  if (message.type === 'control_response' && message.response.request_id === 'ask') {
    fs.writeFileSync('answer.json', JSON.stringify(message.response));
    send({type:'result',subtype:'success',result:'done',is_error:false,session_id:'fixture-session',duration_ms:1,duration_api_ms:0,num_turns:1,total_cost_usd:0,usage:{},modelUsage:{},permission_denials:[]});
    clearTimeout(timer);
  }
});
`;

test(
  'Claude Code is shown attached images inline, may read their folder, and asks with descriptions',
  fixture,
  async (t) => {
    const { base, root, files, space } = await setup(t, 'claude', claudeFixture);
    const events: AgentEvent[] = [];
    let done!: () => void;
    const completed = new Promise<void>((resolve) => {
      done = resolve;
    });
    const service = new AgentService(files, (event) => {
      events.push(event);
      if (event.type === 'question')
        void service.respond(event.requestId!, true, { 'Which plan?': 'Large' });
      if (event.type === 'done') done();
    });
    t.after(() => service.cancel());
    const image = await service.attachments.stage('shot.png', png);
    service.start({
      scopeId: space.scopeId,
      agent: 'claude',
      prompt: 'Describe it',
      attachments: [image],
    });
    await completed;
    assert.equal(events.at(-1)?.outcome, 'completed', JSON.stringify(events.slice(-3)));
    const message = JSON.parse(await readFile(path.join(root, 'message.json'), 'utf8'));
    assert.deepEqual(message.content[0], {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
    });
    assert.equal(message.content[1].type, 'text');
    assert.ok(message.content[1].text.endsWith('Describe it'));
    const args: string[] = JSON.parse(await readFile(path.join(root, 'arguments.json'), 'utf8'));
    assert.equal(
      args[args.indexOf('--add-dir') + 1],
      path.join(base, 'device', 'attachments', image.id),
    );
    const question = events.find((event) => event.type === 'question')!;
    assert.deepEqual(question.questions, [
      {
        id: 'Which plan?',
        title: 'Which plan?',
        header: 'Plan',
        options: [
          { label: 'Small', description: 'Fewer files' },
          { label: 'Large', description: 'More files', preview: '+ a\n+ b' },
        ],
        multiple: false,
        other: true,
      },
    ]);
    const answer = JSON.parse(await readFile(path.join(root, 'answer.json'), 'utf8'));
    assert.equal(answer.response.updatedInput.answers['Which plan?'], 'Large');
  },
);
