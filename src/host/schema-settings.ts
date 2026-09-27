import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SerialQueue } from './serial-queue';
import { hash, textFileByteLimit, type FileService } from './files';
import type { SearchService } from './search';
import { replaceFile } from './local-json';
import { classify } from '../domain/scopes';
import { skillName, skillsRoot } from '../domain/skills';
import {
  attachmentPath,
  claudeSettingsFile,
  instructionsFile,
  ruleFileName,
  rulesRoot,
  settingKind,
  type SchemaSettings,
} from '../domain/schema-settings';
import type { Document } from '../domain/types';
import { t } from '../domain/i18n';

const folderLimit = 2000;
const attachmentLimit = 200;

const refused = () =>
  Error(
    t(
      'この場所は Schema の設定として変更できません。',
      'This location cannot be changed as a Schema setting.',
    ),
  );
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/**
 * Writes the files behind the Schema settings: `AGENTS.md` (the brain's and a
 * knowledge folder's), `.claude/rules/*.md`, `.claude/settings.json` and the files
 * of a skill package. Nothing else is reachable through it: the path must be one
 * `settingKind` names, in the layer that kind belongs to, inside the brain, and no
 * folder on the way or the file itself may be an alias.
 */
export class SchemaSettingsService {
  private queue = new SerialQueue();
  constructor(
    private readonly files: FileService,
    private readonly search: SearchService,
  ) {}

  /** The instructions, rules and skill files a brain has; skills themselves come from `skills`. */
  async list(scopeId: string): Promise<SchemaSettings> {
    const top = await this.files.entries(scopeId, '');
    const instructions = top.some((entry) => entry.path === instructionsFile && !entry.directory)
      ? [instructionsFile]
      : [];
    const folders: string[] = [];
    const nested: string[] = [];
    const walk = await this.search.walk(
      scopeId,
      (relative) => relative.split('/').at(-1) === instructionsFile,
      (directory) => {
        if (folders.length < folderLimit) folders.push(directory);
        return true;
      },
      async ({ path: relative }) => {
        nested.push(relative);
      },
    );
    const rules = (await this.optional(() => this.files.entries(scopeId, rulesRoot)))
      .filter((entry) => !entry.directory && !entry.blocked && ruleFileName(entry.name))
      .map((entry) => entry.path);
    const claudeSettings = (await this.optional(() => this.files.entries(scopeId, '.claude'))).some(
      (entry) => entry.path === claudeSettingsFile && !entry.directory && !entry.blocked,
    );
    const attachments: SchemaSettings['attachments'] = {};
    for (const entry of await this.optional(() => this.files.entries(scopeId, skillsRoot))) {
      if (!entry.directory || entry.blocked || !skillName.safeParse(entry.name).success) continue;
      attachments[entry.name] = await this.attachments(scopeId, entry.path);
    }
    const taken = new Set(nested.map((file) => path.posix.dirname(file)));
    return {
      instructions: [...instructions, ...nested.sort((a, b) => a.localeCompare(b))],
      folders: folders.filter((folder) => !taken.has(folder)).sort((a, b) => a.localeCompare(b)),
      rules: rules.sort((a, b) => a.localeCompare(b)),
      claudeSettings,
      attachments,
      ...(walk.incomplete || folders.length >= folderLimit ? { incomplete: true } : {}),
    };
  }

  /** A setting's text, whatever its extension, under the editor's limits. */
  async read(scopeId: string, relative: string): Promise<Document> {
    const filename = await this.target(scopeId, relative, false);
    const stat = await fs.lstat(filename);
    if (!stat.isFile())
      throw Error(t('通常のファイルではありません。', 'This is not an ordinary file.'));
    if (stat.size > textFileByteLimit) throw Error('The text editor supports files up to 2 MiB');
    const bytes = await fs.readFile(filename);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      text = '\0';
    }
    if (text.includes('\0'))
      throw Error(
        t('テキストではないファイルは編集できません。', 'Only text files can be edited here.'),
      );
    return { scopeId, path: relative, text, hash: hash(bytes) };
  }

  /**
   * Creates (`expected` null), replaces (`expected` the hash of the bytes being
   * replaced) or, with `text` null, deletes one setting file. A file changed
   * meanwhile is never overwritten or removed. Folders a new file needs are
   * created; folders a deletion empties inside a skill package are removed.
   */
  async write(scopeId: string, relative: string, text: string | null, expected: string | null) {
    return this.queue.run(async (): Promise<Document | null> => {
      if (text !== null) {
        if (Buffer.byteLength(text, 'utf8') > textFileByteLimit)
          throw Error('The text editor supports files up to 2 MiB');
        if (text.includes('\0')) throw Error('Binary files cannot be edited as text');
      }
      const filename = await this.target(scopeId, relative, text !== null && expected === null);
      const existing = await fs.lstat(filename).catch((error) => {
        if (!missing(error)) throw error;
      });
      if (existing && (!existing.isFile() || existing.isSymbolicLink()))
        throw Error(t('通常のファイルではありません。', 'This is not an ordinary file.'));
      const current = async () => hash(await fs.readFile(filename));
      if (expected === null) {
        if (existing || text === null)
          throw Error(
            t('同じ名前のファイルが既にあります。', 'A file with the same name already exists.'),
          );
        const created = await fs.open(filename, 'wx');
        try {
          await created.writeFile(text);
          await created.sync();
        } finally {
          await created.close();
        }
        return this.read(scopeId, relative);
      }
      const changed = () =>
        Error(
          t(
            'CONFLICT: ファイルが変更されています。開き直して確認してください。',
            'CONFLICT: The file has changed. Open it again and check.',
          ),
        );
      if (!existing || (await current()) !== expected) throw changed();
      if (text === null) {
        await fs.unlink(filename);
        await this.prune(scopeId, relative);
        return null;
      }
      const temp = path.join(path.dirname(filename), `.irori-save-${randomUUID()}.tmp`);
      try {
        const pending = await fs.open(temp, 'wx', existing.mode);
        try {
          await pending.writeFile(text);
          await pending.sync();
        } finally {
          await pending.close();
        }
        if ((await current()) !== expected) throw changed();
        await replaceFile(temp, filename);
      } finally {
        await fs.rm(temp, { force: true });
      }
      return this.read(scopeId, relative);
    });
  }

  /** Renames a skill package's folder, or with `to` null removes the package and its files. */
  async moveSkill(scopeId: string, name: string, to: string | null) {
    return this.queue.run(async () => {
      skillName.parse(name);
      if (to !== null) skillName.parse(to);
      const from = await this.folder(scopeId, `${skillsRoot}/${name}`, false);
      if (to === null) {
        // The folder itself was checked; rm removes links inside it without following them.
        await fs.rm(from, { recursive: true });
        return;
      }
      const destination = path.join(path.dirname(from), to);
      if (
        await fs.lstat(destination).then(
          () => true,
          (error) => {
            if (!missing(error)) throw error;
            return false;
          },
        )
      )
        throw Error(
          t(`${to} という名前のスキルが既にあります。`, `A skill named ${to} already exists.`),
        );
      await fs.rename(from, destination);
    });
  }

  private async optional<T>(read: () => Promise<T[]>) {
    return read().catch((error) => {
      if (missing(error)) return [] as T[];
      throw error;
    });
  }

  private async attachments(scopeId: string, directory: string) {
    const out: string[] = [];
    const visit = async (folder: string, depth: number) => {
      for (const entry of await this.files.entries(scopeId, folder)) {
        if (out.length >= attachmentLimit || entry.blocked || entry.name.startsWith('.')) continue;
        const inside = entry.path.slice(directory.length + 1);
        if (entry.directory) {
          if (depth < 3) await visit(entry.path, depth + 1);
        } else if (settingKind(entry.path) === 'skill' && attachmentPath(inside)) out.push(inside);
      }
    };
    await visit(directory, 0).catch((error) => {
      if (!missing(error)) throw error;
    });
    return out.sort((a, b) => a.localeCompare(b));
  }

  /** The file a setting path names, after checking every folder on the way. */
  private async target(scopeId: string, relative: string, create: boolean) {
    const kind = settingKind(relative);
    const space = this.files.get(scopeId);
    const layer = classify(space, relative);
    if (
      !kind ||
      (kind === 'instructions' && relative !== instructionsFile
        ? layer !== 'Knowledge_Base'
        : layer !== 'schema')
    )
      throw refused();
    const parent = path.posix.dirname(relative);
    const folder = await this.folder(scopeId, parent === '.' ? '' : parent, create);
    return path.join(folder, path.posix.basename(relative));
  }

  /** A folder inside the brain with no alias on the way, created when asked. */
  private async folder(scopeId: string, relative: string, create: boolean) {
    const space = this.files.get(scopeId);
    let prefix = '';
    for (const part of relative.split('/').filter(Boolean)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      const filename = path.join(space.root, prefix);
      let stat = await fs.lstat(filename).catch((error) => {
        if (!missing(error) || !create) throw error;
      });
      if (!stat) {
        await fs.mkdir(filename);
        stat = await fs.lstat(filename);
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw refused();
      // The file service's own check: the same brain, not a nested one or another layer's alias.
      if ((await this.files.resolve(scopeId, prefix)) !== filename) throw refused();
    }
    return path.join(space.root, relative);
  }

  /** Removes the folders a deletion emptied inside a skill package, never the package itself. */
  private async prune(scopeId: string, relative: string) {
    const parts = relative.split('/');
    if (!relative.startsWith(`${skillsRoot}/`)) return;
    const root = this.files.get(scopeId).root;
    for (let end = parts.length - 1; end > 3; end--) {
      const folder = path.join(root, ...parts.slice(0, end));
      if ((await fs.readdir(folder)).length) return;
      await fs.rmdir(folder);
    }
  }
}
