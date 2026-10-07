import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { t } from '../domain/i18n';
import { languages } from '../domain/i18n';
import { yourAiChoice } from '../domain/conversation';
import {
  markdownFonts,
  themes,
  type Category,
  type DeviceSettings,
  type Space,
} from '../domain/types';
import {
  environmentFile,
  environmentPreferences,
  environmentRepository,
  type EnvironmentRestore,
  type EnvironmentState,
  type RestoreEnvironment,
} from '../domain/environment';
import { githubOwnerPattern, validRepositoryName } from '../domain/git';
import { normalizeGroups } from '../domain/hibachi-groups';
import type { GitHubCli } from '../git/github';
import type { GitService } from '../git/service';
import type { FileService } from './files';
import { ifPresent } from './local-json';
import { inspectRepository, workspaceProfile, type WorkspaceService } from './workspaces';

const repository = z
  .string()
  .max(141)
  .refine((value) => {
    const [owner, name, ...rest] = value.split('/');
    return !rest.length && githubOwnerPattern.test(owner) && validRepositoryName(name ?? '');
  });

/** The file kept in the account's `irori-settings` repository. */
const stored = z.object({
  schemaVersion: z.literal(1),
  savedAt: z.iso.datetime(),
  appVersion: z.string().max(64).optional(),
  hibachis: z
    .array(z.object({ scopeId: z.uuid(), name: z.string().trim().min(1).max(120), repository }))
    .max(500),
  workspaces: z.array(workspaceProfile).max(100),
  preferences: z
    .object({
      theme: z.enum(themes),
      language: z.enum(languages),
      markdownFont: z.enum(markdownFonts),
      editorAssistance: z.boolean(),
      hibachiAgent: z.boolean(),
      yourAi: yourAiChoice,
    })
    .partial(),
  agent: z.object({ repository }).optional(),
});
type Stored = z.infer<typeof stored>;

/** What the environment service reaches in the host. */
export interface EnvironmentHost {
  files: Pick<FileService, 'list'>;
  workspaces: Pick<WorkspaceService, 'list' | 'adopt'>;
  github: Pick<
    GitHubCli,
    'login' | 'protocol' | 'repository' | 'createPrivate' | 'readFile' | 'writeFile'
  >;
  git: Pick<GitService, 'clone'>;
  settings: {
    read(): Promise<DeviceSettings>;
    save(patch: Partial<DeviceSettings>): Promise<unknown>;
  };
  /** The irori agent's folder on this device. */
  agentRoot: () => Promise<string>;
  /** Registers through the host's own guards and starts watching the hibachi. */
  register: (root: string, name: string, category: Category) => Promise<Space>;
  /** Where restored hibachis go unless another folder is chosen. */
  defaultParent: () => Promise<string>;
  appVersion?: string;
  now?: () => Date;
}

/** A hibachi on this device with its GitHub repository, when it has one. */
type Located = { space: Space; repository?: string };

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Saves this device's environment to the GitHub account the GitHub CLI is
 * signed in to, and restores it on another device (ADR 026). Saving replaces
 * the saved environment; restoring only adds to this device.
 */
export class EnvironmentService {
  constructor(private host: EnvironmentHost) {}
  /** The hibachis on this device with their GitHub repositories, when they have one. */
  private async hibachis() {
    const found: Located[] = [];
    for (const space of this.host.files.list())
      found.push({ space, repository: (await inspectRepository(space.root)).repository });
    return found;
  }
  private async agentRepository() {
    const root = await this.host.agentRoot();
    const info = await inspectRepository(root);
    return info.kind === 'github' ? info.repository : undefined;
  }
  /** The environment as this device would save it. */
  private async local(here?: Located[], agent?: string): Promise<Stored> {
    here ??= await this.hibachis();
    agent ??= await this.agentRepository();
    const hibachis = here.flatMap(({ space, repository }) =>
      repository ? [{ scopeId: space.scopeId, name: space.name, repository }] : [],
    );
    const kept = new Set(hibachis.map((item) => item.scopeId));
    const workspaces = (await this.host.workspaces.list()).map(({ groups = [], ...profile }) => {
      const scopeIds = profile.scopeIds.filter((id) => kept.has(id));
      const normalized = normalizeGroups(groups, scopeIds);
      return { ...profile, scopeIds, ...(normalized.length && { groups: normalized }) };
    });
    const settings = await this.host.settings.read();
    return {
      schemaVersion: 1,
      savedAt: (this.host.now?.() ?? new Date()).toISOString(),
      ...(this.host.appVersion && { appVersion: this.host.appVersion }),
      hibachis,
      workspaces,
      preferences: Object.fromEntries(environmentPreferences.map((key) => [key, settings[key]])),
      ...(agent && { agent: { repository: agent } }),
    };
  }
  /** The account's settings repository, refusing a public one. */
  private async place(create: boolean) {
    const login = await this.host.github.login();
    const full = `${login}/${environmentRepository}`;
    const found = await this.host.github.repository(full);
    if (found && !found.private)
      throw Error(
        t(
          `${full} が公開リポジトリのため、環境を保存・読み込みできません。非公開にするか名前を変えてください。`,
          `${full} is public, so irori does not keep the environment there. Make it private or rename it.`,
        ),
      );
    if (!found && create)
      await this.host.github.createPrivate(
        environmentRepository,
        'irori settings: hibachis, workspaces and preferences',
      );
    return { login, full, exists: !!found || create };
  }
  private async read(full: string) {
    const file = await this.host.github.readFile(full, environmentFile);
    if (!file) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(file.text);
    } catch {
      value = undefined;
    }
    const version = (value as { schemaVersion?: unknown } | undefined)?.schemaVersion;
    if (typeof version === 'number' && version > 1)
      throw Error(
        t(
          '保存された環境は新しい irori のものです。irori を更新してください。',
          'The saved environment is from a newer irori. Update irori.',
        ),
      );
    const parsed = stored.safeParse(value);
    if (!parsed.success)
      throw Error(
        t(
          `${full} の ${environmentFile} を読み込めません。`,
          `Could not read ${environmentFile} in ${full}.`,
        ),
      );
    return { sha: file.sha, value: parsed.data };
  }
  async state(): Promise<EnvironmentState> {
    const { login, full, exists } = await this.place(false);
    const saved = exists ? (await this.read(full))?.value : undefined;
    const here = await this.hibachis();
    const agentHere = await this.agentRepository();
    const local = await this.local(here, agentHere);
    return {
      account: login,
      local: {
        hibachis: local.hibachis.length,
        left: here.filter((item) => !item.repository).map((item) => item.space.name),
        ...(local.agent && { agent: local.agent.repository }),
      },
      ...(saved && {
        saved: {
          savedAt: saved.savedAt,
          hibachis: saved.hibachis.map((item) => ({
            ...item,
            here: here.some(
              ({ space, repository }) =>
                space.scopeId === item.scopeId || same(repository, item.repository),
            ),
          })),
          workspaces: saved.workspaces.map((item) => item.name),
          ...(saved.agent && {
            agent: {
              repository: saved.agent.repository,
              here: same(agentHere, saved.agent.repository),
            },
          }),
        },
      }),
      parent: await this.host.defaultParent(),
    };
  }
  /** Replaces the saved environment with this device's. */
  async save(): Promise<EnvironmentState> {
    const { full } = await this.place(true);
    const previous = await this.read(full);
    const value = await this.local();
    await this.host.github.writeFile(
      full,
      environmentFile,
      `${JSON.stringify(value, null, 2)}\n`,
      'Save the irori environment',
      previous?.sha,
    );
    return this.state();
  }
  private async url(repository: string) {
    return (await this.host.github.protocol()) === 'ssh'
      ? `git@github.com:${repository}.git`
      : `https://github.com/${repository}.git`;
  }
  /**
   * Adds the saved environment to this device: the chosen hibachis are cloned
   * and registered, the workspaces are taken in and the preferences applied.
   * Nothing on this device is removed or overwritten but those preferences.
   */
  async restore(input: RestoreEnvironment): Promise<EnvironmentRestore> {
    const { full, exists } = await this.place(false);
    const saved = exists ? (await this.read(full))?.value : undefined;
    if (!saved)
      throw Error(
        t(
          'この GitHub アカウントには保存された環境がありません。',
          'This GitHub account has no saved environment.',
        ),
      );
    const parent = input.parent ?? (await this.host.defaultParent());
    await fs.mkdir(parent, { recursive: true });
    const result: EnvironmentRestore = {
      restored: [],
      failed: [],
      workspaces: 0,
      agent: 'unchanged',
    };
    // A saved hibachi's id here: its own, or that of a checkout of the same repository.
    const ids = new Map<string, string>();
    const here = await this.hibachis();
    for (const item of saved.hibachis) {
      const local = here.find(
        ({ space, repository }) =>
          space.scopeId === item.scopeId || same(repository, item.repository),
      );
      if (local) ids.set(item.scopeId, local.space.scopeId);
    }
    for (const item of saved.hibachis) {
      if (ids.has(item.scopeId) || !input.scopeIds.includes(item.scopeId)) continue;
      try {
        const folder = item.repository.split('/')[1];
        const destination = path.join(parent, folder);
        let root: string;
        if (await fs.stat(destination).catch(() => undefined)) {
          // A checkout of the same repository there already is registered as it is.
          const info = await inspectRepository(destination);
          if (!same(info.repository, item.repository))
            throw Error(t(`${destination} はすでにあります。`, `${destination} already exists.`));
          root = info.root;
        } else
          root = (
            await this.host.git.clone(
              { url: await this.url(item.repository), parent, name: folder },
              true,
            )
          ).path;
        const space = await this.host.register(root, item.name, 'personal');
        ids.set(item.scopeId, space.scopeId);
        result.restored.push(space.name);
      } catch (error) {
        result.failed.push({ name: item.name, message: (error as Error).message });
      }
    }
    if (saved.agent && input.agent)
      result.agent = await this.restoreAgent(saved.agent.repository, result);
    const mapped = saved.workspaces.map((profile) => {
      const scopeIds = [...new Set(profile.scopeIds.map((id) => ids.get(id) ?? id))];
      const groups = (profile.groups ?? []).map((group) => ({
        ...group,
        scopeIds: group.scopeIds.map((id) => ids.get(id) ?? id),
      }));
      return { ...profile, scopeIds, groups };
    });
    result.workspaces = await this.host.workspaces.adopt(mapped);
    await this.host.settings.save(saved.preferences);
    return result;
  }
  /** Clones the irori agent's folder where it is absent or empty. */
  private async restoreAgent(repository: string, result: EnvironmentRestore) {
    const root = await this.host.agentRoot();
    try {
      const entries = await ifPresent(fs.readdir(root));
      if (entries?.length) {
        if (same((await inspectRepository(root)).repository, repository)) return 'unchanged';
        throw Error(t(`${root} にはすでにファイルがあります。`, `${root} already holds files.`));
      }
      if (entries) await fs.rmdir(root);
      else await fs.mkdir(path.dirname(root), { recursive: true });
      await this.host.git.clone(
        { url: await this.url(repository), parent: path.dirname(root), name: path.basename(root) },
        true,
      );
      return 'restored';
    } catch (error) {
      result.failed.push({ name: 'irori agent', message: (error as Error).message });
      return 'failed';
    }
  }
}
