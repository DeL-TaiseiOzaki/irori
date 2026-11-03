import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import * as prompts from '../prompts';

// prompts/ is where the words irori gives an agent are found; its README is
// the index. A file or an export the index does not name is one nobody finds.
test('Every prompt file is exported from prompts/index.ts and indexed in its README', async () => {
  const index = await readFile('prompts/index.ts', 'utf8');
  const readme = await readFile('prompts/README.md', 'utf8');
  const files = (await readdir('prompts')).filter(
    (name) => name.endsWith('.ts') && name !== 'index.ts',
  );
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.ok(index.includes(`from './${file.slice(0, -3)}'`), `${file} is not exported`);
    assert.ok(readme.includes(`](${file})`), `${file} is not in prompts/README.md`);
  }
  for (const name of Object.keys(prompts))
    assert.ok(readme.includes(`\`${name}\``), `${name} is not in prompts/README.md`);
});

test('Connected folders are named for agents, with how to search inside the links', () => {
  const drive = { path: 'contents/Drive', target: '/Users/me/Google Drive/Lab' };
  const team = { path: 'contents/Team', target: '/Users/me/Team' };
  const text = prompts.connectedFolders([drive, team]);
  assert.match(
    text,
    /"contents\/Drive" \(on this device "\/Users\/me\/Google Drive\/Lab"\), "contents\/Team" \(on this device "\/Users\/me\/Team"\)/,
  );
  // The CLI also lists the place on this device; the agent hears it is the same
  // folder, to go through the link and to write the link's path (ADR 019 D6).
  assert.match(text, /The place in brackets is that same folder, not another one/);
  assert.match(text, /write that path in notes, links and replies, not the place on this device/);
  assert.match(text, /rg PATTERN "contents\/Drive"/);
  assert.match(text, /rg -L/);
  // find names the link itself unless the path ends in a slash or it follows links.
  assert.ok(text.includes('`find "contents/Drive/"` with the final slash'));
  assert.match(text, /find -L/);
  assert.match(text, /finding nothing means nothing there matches/);
  // Google Docs files there hold only an ID, which the agent reads with its own tools.
  assert.match(text, /\.gsheet/);
  assert.match(text, /`doc_id`/);
  assert.ok(text.includes('https://docs.google.com/document/d/<doc_id>'));
  assert.match(text, /spreadsheets\/d\/<doc_id> for a \.gsheet/);
  assert.match(prompts.iroriAgentSkills['connect-folder'], /spreadsheets\/d\/<doc_id>/);
  assert.doesNotMatch(Object.values(prompts.iroriAgentSkills).join('\n'), /cannot read/);
  const brains = [
    { name: 'Lab', agent: 'vault-lab', root: '/kb/lab', linked: [drive] },
    { name: 'Notes', agent: 'vault-notes', root: '/kb/notes' },
  ];
  const handed = prompts.brainsCommandPreamble(brains);
  assert.match(
    handed,
    /- Lab: folder "\/kb\/lab", vault agent "vault-lab", connected folders "contents\/Drive" \(on this device "\/Users\/me\/Google Drive\/Lab"\)/,
  );
  assert.match(handed, /- Notes: folder "\/kb\/notes", vault agent "vault-notes"$/m);
  assert.equal(handed.match(/rg -L/g)?.length, 1);
  // The irori agent works in its own folder: its example is the whole path through the vault.
  assert.match(handed, /as in "\/kb\/lab\/contents\/Drive"/);
  assert.match(handed, /rg PATTERN "\/kb\/lab\/contents\/Drive"/);
  assert.match(handed, /Tell a vault agent the folder's path in contents/);
  // A Windows vault's example is written with forward slashes, which every shell there takes.
  const windows = prompts.brainsCommandPreamble([
    {
      ...brains[0],
      root: 'C:\\Users\\me\\irori\\lab',
      linked: [{ ...drive, target: 'C:\\Sync\\Lab' }],
    },
  ]);
  assert.ok(windows.includes('as in "C:/Users/me/irori/lab/contents/Drive"'));
  assert.ok(windows.includes('`find "C:/Users/me/irori/lab/contents/Drive/"`'));
  // A read-only folder keeps its place and is marked; neither agent is told to change it.
  const kept = prompts.connectedFolders([drive, team], ['contents/Drive']);
  assert.match(kept, /Read-only: "contents\/Drive"\. The person connected them to be read only/);
  assert.match(kept, /read, search and, unless it is read-only, change the folder/);
  const handedKept = prompts.brainsCommandPreamble([
    { ...brains[0], readOnly: ['contents/Drive'] },
  ]);
  assert.match(
    handedKept,
    /connected folders "contents\/Drive" \(on this device "\/Users\/me\/Google Drive\/Lab"\) \(read-only\)/,
  );
  assert.match(handedKept, /One marked \(read-only\) must never be created in/);
  // Without connected folders nothing is said about them.
  assert.doesNotMatch(prompts.brainsCommandPreamble([brains[1]]), /rg -L|connected folders/);
});

// A vault agent hears what irori is and where each layer is (ADR 039):
// AGENTS.md says where the rest of the Schema is, the introduction what irori changes.
test("A vault agent's introduction names its layers' folders and points at AGENTS.md", () => {
  const vault = {
    name: 'Lab',
    contents: ['contents', 'refs'],
    knowledge: 'wiki',
    labels: { contents: '資料' },
    instructions: true,
    linked: [{ path: 'contents/Drive', target: '/Users/me/Drive' }],
  };
  const text = prompts.vaultIntro(vault, true);
  assert.match(text, /^irori: you are the agent of the "Lab" vault, open in irori/);
  assert.match(text, /AGENTS\.md is this vault's instructions and says where its skills/);
  assert.match(text, /^- Knowledge: "wiki\/" and every other file outside Schema and Contents\./m);
  assert.match(text, /^- Contents \(shown as "資料"\): "contents\/", "refs\/"\./m);
  assert.match(
    text,
    /^Connected folders in Contents: "contents\/Drive" \(on this device "\/Users\/me\/Drive"\)\./m,
  );
  assert.match(text, /relative Markdown links, not \[\[wiki links\]\]/);
  assert.ok(text.endsWith(prompts.vaultCommandPreamble));
  // The command's essentials only: the rest is in `irori help`.
  assert.match(prompts.vaultCommandPreamble, /`irori move`[\s\S]*`irori trash`[\s\S]*`mv`/);
  assert.ok(prompts.vaultCommandPreamble.length < 500);
  assert.match(prompts.iroriCommandHelp('/home', true), /\.property\/property\.json/);
  // Knowledge at the root, no AGENTS.md, no connected folders, no command.
  const bare = prompts.vaultIntro(
    { name: 'Root', contents: ['contents'], knowledge: '.', instructions: false },
    false,
  );
  assert.match(bare, /this vault has no AGENTS\.md yet\./);
  assert.match(bare, /^- Knowledge: the vault's root: every file outside Schema and Contents\./m);
  assert.doesNotMatch(bare, /Connected folders|`irori`/);
  // Without a declared knowledge folder it is Knowledge_Base.
  assert.match(
    prompts.vaultIntro({ name: 'Old', contents: [], instructions: true }, false),
    /^- Knowledge: "Knowledge_Base\/"[\s\S]*^- Contents: no folder yet\./m,
  );
  assert.match(prompts.vaultIntroPointer('Lab', true), /`irori list` shows the layers again/);
  // Where it keeps scratch work: never the system's temporary folder.
  const working = prompts.vaultIntro({ ...vault, work: '.irori/work/' }, false);
  assert.match(working, /^Work folder: "\.irori\/work\/"\. Keep scratch files, .*%TEMP%/m);
  assert.doesNotMatch(text, /Work folder/);
  const handed = prompts.brainsCommandPreamble([
    { name: 'Lab', agent: 'vault-lab', root: '/kb/lab', work: '/kb/lab/.irori/work' },
    { name: 'Notes', agent: 'vault-notes', root: '/kb/notes', work: 'D:\\work\\notes' },
  ]);
  assert.match(
    handed,
    /- Lab: folder "\/kb\/lab", vault agent "vault-lab", work folder "\/kb\/lab\/\.irori\/work"/,
  );
  assert.equal(handed.match(/temporary folder/g)?.length, 1);
  // The irori agent hears each handed vault's layers on its line.
  assert.match(
    prompts.brainsCommandPreamble([
      {
        name: 'Lab',
        agent: 'vault-lab',
        root: '/kb/lab',
        layers: { knowledge: '.', contents: ['contents'] },
      },
    ]),
    /- Lab: folder "\/kb\/lab", vault agent "vault-lab", knowledge "\.", contents "contents"$/m,
  );
});

// ADR 050: every CLI hands a vault's work to its vault agent with `irori call`,
// and a vault's own definition of its agent is told to both sides.
test('The irori agent hands vaults with irori call on every CLI, and hears each vault agent’s own description', () => {
  const handed = prompts.brainsCommandPreamble([
    { name: 'Lab', agent: 'vault-lab', root: '/kb/lab', description: 'Papers and reading notes.' },
    { name: 'Notes', agent: 'vault-notes', root: '/kb/notes' },
  ]);
  assert.match(handed, /vault agent "vault-lab", its agent: "Papers and reading notes\."/);
  assert.match(handed, /irori call <vault agent or vault name> "<task>"/);
  assert.match(handed, /Not your CLI's own sub-agents/);
  assert.doesNotMatch(handed, /sub-agent "|spawn_agent|task tool/);
  // The vault agent gets the task, with the vault's definition when it has one.
  assert.equal(
    prompts.handedTask('Tidy the inbox.'),
    `${prompts.handedTask('Tidy the inbox.').split('\n\n')[0]}\n\nTidy the inbox.`,
  );
  const defined = prompts.handedTask('Tidy the inbox.', {
    file: '.codex/agents/vault-agent.toml',
    instructions: 'File every note under wiki/.',
  });
  assert.match(
    defined,
    /in \.codex\/agents\/vault-agent\.toml\. Follow it:\n<vault-agent-definition>\nFile every note under wiki\/\.\n<\/vault-agent-definition>\n\nTidy the inbox\.$/,
  );
});
