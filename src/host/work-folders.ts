import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { within } from '../domain/scopes';
import { t } from '../domain/i18n';
import type { Space, WorkFolder } from '../domain/types';
import { isMissing, readLocalJson, writeLocalJson } from './local-json';

/**
 * Where a vault's agents work unless the person chose another folder: `work`
 * in the vault's (first) contents folder, where the explorer shows it (ADR 044).
 */
export const workFolderName = 'work';
/** The default until 0.2.19 (ADR 042); a folder left there moves to the new place. */
export const formerWorkFolder = '.irori/work';
/** The default work folder's path inside a vault. */
export const defaultWorkFolder = (space: Pick<Space, 'contents'>) =>
  `${space.contents[0]}/${workFolderName}`;
/** Written into the default folder so that what the agents leave there stays out of Git. */
const ignoreAll = '# Agents work here; irori keeps it out of Git.\n*\n';

const recordSchema = z.record(z.string(), z.string().min(1));

/**
 * The folder each vault's agents work in: scratch files, intermediate results,
 * downloads and trial scripts, where the person can look at them. By default it
 * is `contents/work` in the vault; the person may choose another folder on this
 * device. A chosen path names the person, so it stays in irori's data, out of
 * the vault's records, as a connected folder's does.
 */
export class WorkFolders {
  constructor(private files: { dataDir: string; get(id: string): Space; list(): Space[] }) {}
  private get file() {
    return path.join(this.files.dataDir, 'work-folders.json');
  }
  private async chosen(): Promise<Record<string, string>> {
    const parsed = recordSchema.safeParse(await readLocalJson(this.file, {}).catch(() => ({})));
    return parsed.success ? parsed.data : {};
  }
  private fallback(scopeId: string) {
    const space = this.files.get(scopeId);
    return path.join(space.root, ...defaultWorkFolder(space).split('/'));
  }
  /**
   * The folder a vault's agents work in now. A chosen folder that is not there,
   * such as one on a drive not mounted yet, gives way to the default meanwhile.
   */
  async folder(scopeId: string): Promise<WorkFolder> {
    const fallback = this.fallback(scopeId);
    const chosen = (await this.chosen())[scopeId];
    if (!chosen) return { path: fallback, chosen: false };
    const there = await fs.stat(chosen).then(
      (info) => info.isDirectory(),
      () => false,
    );
    return there
      ? { path: chosen, chosen: true }
      : { path: fallback, chosen: true, missing: chosen };
  }
  /** The folder, made first when it is the default and not there yet, for a run or the file manager. */
  async prepare(scopeId: string): Promise<string> {
    const folder = await this.folder(scopeId);
    if (folder.path === this.fallback(scopeId)) await this.makeDefault(scopeId);
    return folder.path;
  }
  private async makeDefault(scopeId: string) {
    const space = this.files.get(scopeId);
    const folder = defaultWorkFolder(space);
    const parts = folder.split('/');
    const blocked = () =>
      Error(
        t(
          `作業フォルダ ${folder} の場所にリンクやファイルがあります。`,
          `A link or a file is where the work folder ${folder} goes.`,
        ),
      );
    const look = (at: string) =>
      fs.lstat(at).catch((error) => {
        if (!isMissing(error)) throw error;
        return undefined;
      });
    let current = space.root;
    // Made one level at a time, so that no link leads it out of the vault.
    for (const part of parts.slice(0, -1)) {
      current = path.join(current, part);
      const info = await look(current);
      if (!info) await fs.mkdir(current);
      else if (!info.isDirectory() || info.isSymbolicLink()) throw blocked();
    }
    current = path.join(current, parts.at(-1)!);
    const info = await look(current);
    if (info) {
      if (!info.isDirectory() || info.isSymbolicLink()) throw blocked();
      return;
    }
    // What the agents left in the former default comes along, its .gitignore with it.
    const former = path.join(space.root, ...formerWorkFolder.split('/'));
    const before = await look(former);
    if (before?.isDirectory() && !before.isSymbolicLink())
      try {
        await fs.rename(former, current);
        return;
      } catch (error) {
        console.warn('The former work folder stays where it is', String(error));
      }
    await fs.mkdir(current);
    // Only a folder irori makes is kept out of Git; one the person made stays theirs.
    await fs.writeFile(path.join(current, '.gitignore'), ignoreAll, { flag: 'wx' });
  }
  /**
   * Chooses the folder a vault's agents work in, or the default again with `null`.
   * It must be a folder that exists, neither a vault's root nor holding one, not
   * inside another vault, and apart from irori's data. Nothing is made or moved.
   */
  async choose(scopeId: string, chosen: string | null): Promise<WorkFolder> {
    const records = await this.chosen();
    if (chosen === null) {
      delete records[scopeId];
      await writeLocalJson(this.file, records);
      return this.folder(scopeId);
    }
    const missing = () => Error(t('フォルダが見つかりません。', 'The folder was not found.'));
    if (!path.isAbsolute(chosen)) throw missing();
    const target = await fs.realpath(chosen).catch(() => {
      throw missing();
    });
    if (!(await fs.stat(target)).isDirectory()) throw missing();
    const refuse = () =>
      Error(
        t(
          '作業フォルダには、vault のルート、ほかの vault や irori のデータと重なるフォルダは選べません。',
          "The work folder cannot be a vault's root, or overlap another vault or irori's data.",
        ),
      );
    const data = await fs.realpath(this.files.dataDir).catch(() => this.files.dataDir);
    if (within(data, target) || within(target, data)) throw refuse();
    for (const other of this.files.list()) {
      const root = await fs.realpath(other.root).catch(() => other.root);
      if (within(target, root)) throw refuse();
      if (other.scopeId !== scopeId && within(root, target)) throw refuse();
    }
    records[scopeId] = target;
    await writeLocalJson(this.file, records);
    return this.folder(scopeId);
  }
}
