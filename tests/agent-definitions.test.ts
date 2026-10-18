import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import {
  definitionModel,
  foreignDefinitions,
  pruneCodexRoles,
  readAgentDefinitions,
  removeCodexRoles,
  vaultAgentDefinition,
  writeCodexRoles,
} from '../src/agents/agent-definitions';

async function folder(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), 'irori definitions '));
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  return root;
}

test('the three formats are read as CLIs read them, and what does not parse is named', async (t) => {
  const root = await folder({
    '.claude/agents/reviewer.md':
      '---\nname: reviewer\ndescription: Reviews a draft.\nmodel: sonnet\ntools: Read, Grep\n---\n\nReview the draft.\n',
    '.codex/agents/vault-agent.toml':
      'name = "vault-agent"\ndescription = "Product decisions."\nmodel = "gpt-test"\ndeveloper_instructions = """\nFile each decision.\n"""\n',
    '.codex/agents/minutes.toml':
      "description = 'Writes minutes.'\ndeveloper_instructions = 'Write the minutes.'\nnickname_candidates = [\n  \"Ada\",\n]\n",
    '.opencode/agents/scribe.md':
      '---\ndescription: Takes notes.\nmode: subagent\n---\nTake notes.\n',
    '.opencode/agents/build.md': '---\ndescription: Builds.\nmode: primary\n---\nBuild.\n',
    '.claude/agents/broken.md': 'no front matter',
    '.codex/agents/empty.toml': 'description = "No instructions."\n',
    '.claude/agents/notes.txt': 'not a definition',
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  await symlink(
    path.join(root, '.claude', 'agents', 'reviewer.md'),
    path.join(root, '.claude', 'agents', 'linked.md'),
  );
  const { definitions, problems } = await readAgentDefinitions(root);
  assert.deepEqual(
    definitions.map((item) => [item.format, item.name]),
    [
      ['claude', 'reviewer'],
      ['codex', 'minutes'],
      ['codex', 'vault-agent'],
      ['opencode', 'scribe'],
    ],
  );
  const reviewer = definitions[0];
  assert.equal(reviewer.description, 'Reviews a draft.');
  assert.equal(reviewer.instructions, 'Review the draft.');
  assert.equal(reviewer.model, 'sonnet');
  assert.equal(definitions[2].instructions, 'File each decision.');
  // A primary OpenCode agent is not a sub-agent; the rest that fail are named.
  assert.deepEqual(problems.map((item) => item.file).sort(), [
    '.claude/agents/broken.md',
    '.claude/agents/linked.md',
    '.codex/agents/empty.toml',
  ]);
});

test('a CLI gets the formats it does not read, its own name winning, refused names left out', () => {
  const item = (name: string, format: 'claude' | 'codex' | 'opencode', model?: string) => ({
    name,
    format,
    file: `${format}/${name}`,
    description: `${name} (${format})`,
    instructions: 'Do it.',
    ...(model && { model }),
  });
  const definitions = [
    item('reviewer', 'claude'),
    item('reviewer', 'codex'),
    item('minutes', 'codex'),
    item('minutes', 'opencode'),
    item('vault-agent', 'codex', 'gpt-test'),
    item('vault-agent', 'claude', 'sonnet'),
  ];
  const refused = (name: string) => name === 'vault-agent';
  assert.deepEqual(
    foreignDefinitions(definitions, 'claude', refused).map((d) => [d.name, d.format]),
    [['minutes', 'codex']],
  );
  // Codex has both names in its own format.
  assert.deepEqual(foreignDefinitions(definitions, 'codex', refused), []);
  assert.deepEqual(
    foreignDefinitions(definitions, 'opencode', refused).map((d) => [d.name, d.format]),
    [['reviewer', 'claude']],
  );
  // Pi and Hermes Agent load no sub-agents.
  assert.deepEqual(foreignDefinitions(definitions, 'pi', refused), []);
  // The vault's own agent: the running CLI's format first, its model only in its terms.
  assert.equal(vaultAgentDefinition(definitions, 'codex')?.format, 'codex');
  assert.equal(vaultAgentDefinition(definitions, 'claude')?.format, 'claude');
  assert.equal(vaultAgentDefinition(definitions, 'pi')?.format, 'codex');
  assert.equal(definitionModel(vaultAgentDefinition(definitions, 'claude'), 'claude'), 'sonnet');
  assert.equal(definitionModel(vaultAgentDefinition(definitions, 'pi'), 'pi'), undefined);
  assert.equal(definitionModel(item('x', 'claude', 'inherit'), 'claude'), undefined);
  assert.equal(definitionModel(item('x', 'claude', '--danger'), 'claude'), undefined);
});

test('Codex roles are written as configuration files in irori’s data, and go with the run', async (t) => {
  const data = await mkdtemp(path.join(tmpdir(), 'irori roles '));
  t.after(() => rm(data, { recursive: true, force: true }));
  assert.equal(await writeCodexRoles(data, 'run-1', []), undefined);
  const config = await writeCodexRoles(data, 'run-1', [
    {
      name: 'reviewer',
      format: 'claude',
      file: '.claude/agents/reviewer.md',
      description: 'Reviews "drafts".',
      instructions: 'Line one.\n"Quoted" \\ line two.',
    },
  ]);
  const file = path.join(data, 'codex-agents', 'run-1', 'reviewer.toml');
  assert.deepEqual(config, {
    'agents.reviewer.description': 'Reviews "drafts".',
    'agents.reviewer.config_file': file,
  });
  assert.deepEqual(
    { ...parseToml(await readFile(file, 'utf8')) },
    { developer_instructions: 'Line one.\n"Quoted" \\ line two.' },
  );
  await writeCodexRoles(data, 'run-2', [
    { name: 'x', format: 'claude', file: 'x', description: 'x', instructions: 'x' },
  ]);
  await pruneCodexRoles(data, (id) => id === 'run-2');
  assert.deepEqual(await readdir(path.join(data, 'codex-agents')), ['run-2']);
  await removeCodexRoles(data, 'run-2');
  assert.deepEqual(await readdir(path.join(data, 'codex-agents')), []);
});
