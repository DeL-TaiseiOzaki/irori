import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SerialQueue } from './serial-queue';
import { editableText, hash, utf8Text, type FileService } from './files';
import type { SearchService } from './search';
import { isMissing, ordinaryFolders, replaceChecked, writeExclusive } from './local-json';
import { textFileByteLimit } from '../domain/viewers';
import { spaceFolder, type SchemaFolder } from './schema-folder';
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

/**
 * Writes the files behind the Schema settings: `AGENTS.md` (the brain's and a
 * knowledge folder's), `.claude/rules/*.md`, `.claude/settings.json` and the files
 * of a skill package. Nothing else is reachable through it: the path must be one
 * `settingKind` names, in the layer that kind belongs to, inside the brain, and no
 * folder on the way or the file itself may be an alias. The same holds for the
 * irori agent's folder, which `folderOf` resolves by its id; there only the root
 * `AGENTS.md` counts as instructions.
 */
export class SchemaSettingsService {
  private queue = new SerialQueue();
  constructor(
    files: FileService,
    private readonly search: SearchService,
    private readonly folderOf: (scopeId: string) => Promise<SchemaFolder> = async (scopeId) =>
      spaceFolder(files, scopeId),
  ) {}

  /** The instructions, rules and skill files a brain has; skills themselves come from `skills`. */
  async list(scopeId: string): Promise<SchemaSettings> {
    const folder = await this.folderOf(scopeId);
    const top = await folder.entries('');
    const instructions = top.some((entry) => entry.path === instructionsFile && !entry.directory)
      ? [instructionsFile]
      : [];
    const folders: string[] = [];
    const nested: string[] = [];
    const walk = folder.knowledge
      ? await this.search.walk(
          scopeId,
          (relative) => relative.split('/').at(-1) === instructionsFile,
          (directory) => {
            if (folders.length < folderLimit) folders.push(directory);
            return true;
          },
          async ({ path: relative }) => {
            nested.push(relative);
          },
        )
      : { incomplete: false };
    const rules = (await this.optional(() => folder.entries(rulesRoot)))
      .filter((entry) => !entry.directory && !entry.blocked && ruleFileName(entry.name))
      .map((entry) => entry.path);
    const claudeSettings = (await this.optional(() => folder.entries('.claude'))).some(
      (entry) => entry.path === claudeSettingsFile && !entry.directory && !entry.blocked,
    );
    const attachments: SchemaSettings['attachments'] = {};
    for (const entry of await this.optional(() => folder.entries(skillsRoot))) {
      if (!entry.directory || entry.blocked || !skillName.safeParse(entry.name).success) continue;
      attachments[entry.name] = await this.attachments(folder, entry.path);
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
    const filename = await this.target(await this.folderOf(scopeId), relative, false);
    const stat = await fs.lstat(filename);
    if (!stat.isFile())
      throw Error(t('通常のファイルではありません。', 'This is not an ordinary file.'));
    if (stat.size > textFileByteLimit) throw Error('The text editor supports files up to 2 MiB');
    const bytes = await fs.readFile(filename);
    const text = utf8Text(bytes);
    if (text === undefined)
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
      if (text !== null) editableText(text);
      const folder = await this.folderOf(scopeId);
      // The irori agent's AGENTS.md marks its folder as set up; it is edited, never removed.
      if (!folder.knowledge && relative === instructionsFile && text === null) throw refused();
      const filename = await this.target(folder, relative, text !== null && expected === null);
      const existing = await fs.lstat(filename).catch((error) => {
        if (!isMissing(error)) throw error;
      });
      if (existing && (!existing.isFile() || existing.isSymbolicLink()))
        throw Error(t('通常のファイルではありません。', 'This is not an ordinary file.'));
      const current = async () => hash(await fs.readFile(filename));
      if (expected === null) {
        if (existing || text === null)
          throw Error(
            t('同じ名前のファイルが既にあります。', 'A file with the same name already exists.'),
          );
        await writeExclusive(filename, text);
        return this.read(scopeId, relative);
      }
      const changed = () =>
        Error(t('CONFLICT: ファイルが変更されています。', 'CONFLICT: The file has changed.'));
      if (!existing || (await current()) !== expected) throw changed();
      if (text === null) {
        await fs.unlink(filename);
        await this.prune(folder, relative);
        return null;
      }
      await replaceChecked(filename, text, existing.mode, async () => {
        if ((await current()) !== expected) throw changed();
      });
      return this.read(scopeId, relative);
    });
  }

  /** Renames a skill package's folder, or with `to` null removes the package and its files. */
  async moveSkill(scopeId: string, name: string, to: string | null) {
    return this.queue.run(async () => {
      skillName.parse(name);
      if (to !== null) skillName.parse(to);
      const from = await this.folder(await this.folderOf(scopeId), `${skillsRoot}/${name}`, false);
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
            if (!isMissing(error)) throw error;
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
      if (isMissing(error)) return [] as T[];
      throw error;
    });
  }

  private async attachments(schema: SchemaFolder, directory: string) {
    const out: string[] = [];
    const visit = async (folder: string, depth: number) => {
      for (const entry of await schema.entries(folder)) {
        if (out.length >= attachmentLimit || entry.blocked || entry.name.startsWith('.')) continue;
        const inside = entry.path.slice(directory.length + 1);
        if (entry.directory) {
          if (depth < 3) await visit(entry.path, depth + 1);
        } else if (settingKind(entry.path) === 'skill' && attachmentPath(inside)) out.push(inside);
      }
    };
    await visit(directory, 0).catch((error) => {
      if (!isMissing(error)) throw error;
    });
    return out.sort((a, b) => a.localeCompare(b));
  }

  /** The file a setting path names, after checking every folder on the way. */
  private async target(schema: SchemaFolder, relative: string, create: boolean) {
    const kind = settingKind(relative);
    const layer = schema.layer(relative);
    if (
      !kind ||
      (schema.settings && !schema.settings.includes(kind)) ||
      (kind === 'instructions' && relative !== instructionsFile
        ? layer !== 'Knowledge_Base'
        : layer !== 'schema')
    )
      throw refused();
    const parent = path.posix.dirname(relative);
    const folder = await this.folder(schema, parent === '.' ? '' : parent, create);
    return path.join(folder, path.posix.basename(relative));
  }

  /** A folder inside the brain with no alias on the way, created when asked. */
  private async folder(schema: SchemaFolder, relative: string, create: boolean) {
    // Each folder's own check: the same brain, not a nested one or another layer's alias.
    await ordinaryFolders(relative, create, {
      location: (prefix) => path.join(schema.root, prefix),
      resolve: (prefix) => schema.resolve(prefix),
      notFolder: refused,
      moved: refused,
    });
    return path.join(schema.root, relative);
  }

  /** Removes the folders a deletion emptied inside a skill package, never the package itself. */
  private async prune(schema: SchemaFolder, relative: string) {
    const parts = relative.split('/');
    if (!relative.startsWith(`${skillsRoot}/`)) return;
    const root = schema.root;
    for (let end = parts.length - 1; end > 3; end--) {
      const folder = path.join(root, ...parts.slice(0, end));
      if ((await fs.readdir(folder)).length) return;
      await fs.rmdir(folder);
    }
  }
}
