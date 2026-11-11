import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import { t } from '../domain/i18n';
import type { AgentId } from '../domain/types';

/**
 * The files in the folder a CLI works in that make it run commands, start
 * servers or change where it connects without asking: Claude Code's project
 * settings (hooks, `env`, `apiKeyHelper`, permission rules, plugins) and
 * `.mcp.json`, OpenCode's project config and plugins, Pi's extensions. A vault
 * from someone else can carry any of them, so they run only as the person allowed.
 */
const own: Partial<Record<AgentId, { files: string[]; folders: string[] }>> = {
  claude: {
    files: ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json'],
    folders: [],
  },
  opencode: {
    files: [
      'opencode.json',
      'opencode.jsonc',
      '.opencode/opencode.json',
      '.opencode/opencode.jsonc',
    ],
    folders: ['.opencode/plugin', '.opencode/plugins'],
  },
  pi: { files: [], folders: ['.pi/extensions'] },
};
/** A folder given beside it: Claude Code loads its `.claude` (skills, agents, commands, plugins). */
const added: Partial<Record<AgentId, string[]>> = { claude: ['.claude'] };
const fileLimit = 500;

/** Where a run's CLI reads configuration: its working folder, or one given beside it. */
export type ConfigPlace = { root: string; added?: boolean };
/** What was found in one place, or a configuration irori passes itself (`label`). */
export type FoundConfig = { root: string; label?: string; files: string[]; digest: string };

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function entry(file: string): Promise<string | undefined> {
  const info = await fs.lstat(file).catch(() => undefined);
  if (!info) return undefined;
  if (info.isSymbolicLink()) return `link ${await fs.readlink(file).catch(() => '?')}`;
  if (!info.isFile()) return undefined;
  return sha256(await fs.readFile(file));
}

async function walk(root: string, rel: string, out: [string, string][], depth = 0) {
  const entries = await fs
    .readdir(path.join(root, rel), { withFileTypes: true })
    .catch(() => undefined);
  for (const item of entries ?? []) {
    if (out.length >= fileLimit) return;
    const child = `${rel}/${item.name}`;
    if (item.isDirectory() && depth < 8) await walk(root, child, out, depth + 1);
    else {
      const value = await entry(path.join(root, child));
      if (value) out.push([child, value]);
    }
  }
}

/** The configuration of one place that runs without asking on `agent`, or nothing. */
export async function findConfig(
  place: ConfigPlace,
  agent: AgentId,
): Promise<FoundConfig | undefined> {
  const found: [string, string][] = [];
  for (const rel of place.added ? [] : (own[agent]?.files ?? [])) {
    const value = await entry(path.join(place.root, rel));
    if (value) found.push([rel, value]);
  }
  for (const rel of place.added ? (added[agent] ?? []) : (own[agent]?.folders ?? []))
    await walk(place.root, rel, found);
  if (!found.length) return undefined;
  found.sort(([a], [b]) => (a < b ? -1 : 1));
  return {
    // Allowed per CLI: each reads its own files.
    root: `${agent}:${place.root}`,
    files: found.map(([rel]) => path.join(place.root, rel)),
    digest: sha256(JSON.stringify(found)),
  };
}

/**
 * What the person allowed, by place: a run whose configuration changed since
 * waits for their answer, and does not start when they refuse.
 */
export class ConfigApprovals {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private file: string,
    private ask: (found: FoundConfig[]) => Promise<boolean>,
  ) {}
  private async allowed(): Promise<Record<string, string>> {
    try {
      const value = JSON.parse(await fs.readFile(this.file, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }
  private async changed(agent: AgentId, places: ConfigPlace[], extra: FoundConfig[]) {
    const allowed = await this.allowed();
    const found = [
      ...(await Promise.all(places.map((place) => findConfig(place, agent)))).flatMap((item) =>
        item ? [item] : [],
      ),
      ...extra,
    ];
    return { allowed, changed: found.filter((item) => allowed[item.root] !== item.digest) };
  }
  /** Whether every place holds only configuration the person allowed (none counts). */
  async isAllowed(agent: AgentId, places: ConfigPlace[], extra: FoundConfig[] = []) {
    return !(await this.changed(agent, places, extra)).changed.length;
  }
  /** Asks about what changed since the person allowed it; refuses when they do not allow it. */
  async check(agent: AgentId, places: ConfigPlace[], extra: FoundConfig[] = []): Promise<void> {
    await this.settle(agent, places, extra, (changed) => this.ask(changed));
  }
  /**
   * Records what changed as allowed without asking, and returns it: a run in full
   * access, which the person let act without asking (ADR 009), loads it by that
   * choice. Once it has run here, asking about the same content again protects
   * nothing; a later change is asked about as usual.
   */
  allow(agent: AgentId, places: ConfigPlace[], extra: FoundConfig[] = []) {
    return this.settle(agent, places, extra, async () => true);
  }
  private settle(
    agent: AgentId,
    places: ConfigPlace[],
    extra: FoundConfig[],
    decide: (changed: FoundConfig[]) => Promise<boolean>,
  ): Promise<FoundConfig[]> {
    // One question at a time, so two runs of one vault do not ask twice.
    const next = this.queue.then(async () => {
      const { allowed, changed } = await this.changed(agent, places, extra);
      if (!changed.length) return changed;
      if (!(await decide(changed))) throw new ConfigRefused();
      for (const item of changed) allowed[item.root] = item.digest;
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      await writeFileAtomic(this.file, JSON.stringify(allowed, null, 2) + '\n', { mode: 0o600 });
      return changed;
    });
    this.queue = next.catch(() => {});
    return next;
  }
}

export class ConfigRefused extends Error {
  constructor() {
    super(
      t(
        '確認なしで動くエージェントの設定を許可しなかったため、実行しませんでした。',
        'The agent configuration that runs without asking was not allowed, so the request did not run.',
      ),
    );
  }
}
