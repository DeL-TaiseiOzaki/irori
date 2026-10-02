import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SerialQueue } from '../host/serial-queue';
import {
  cloudDeclaration,
  entryNameError,
  localDeclaration,
  mountNameError,
  nameKey,
} from '../domain/connections';
import { owner, within } from '../domain/scopes';
import { readLocalJson, writeLocalFile, writeLocalJson } from '../host/local-json';
import { draftFile, hash, readDocument, textFileByteLimit } from '../host/files';
import { noteFilename } from '../domain/note-operations';
import type { CloudStorage } from './storage';
import type {
  AddLocalFolder,
  Attachment,
  CloudAccess,
  CloudAttachment,
  CloudConnection,
  Document,
  Entry,
  LocalAttachment,
} from '../domain/types';
import { t } from '../domain/i18n';

// Where a local connection's folder is on this device: a path names the person, and
// often their account, so it stays here and out of the hibachi's records.
const localBindingSchema = z.object({
  scopeId: z.uuid(),
  mountId: z.uuid(),
  root: z.string(),
  path: z.string().min(1),
});
type LocalBinding = z.infer<typeof localBindingSchema>;
// A retired Drive connection's device record (ADR 023): only the empty folder irori
// once made as its mount point is read from it, so that folder can be removed.
const retiredBindingSchema = z.object({
  placeholder: z.object({ dev: z.number(), ino: z.number() }).optional(),
});
function assertCloudPath(rel: string) {
  if (
    !rel ||
    rel.includes('\\') ||
    rel.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw Error('Invalid cloud path');
}
const connectionFolderError = () =>
  Error(
    t(
      '接続フォルダ自体はここでは変更できません。',
      'The connection folder itself cannot be changed here.',
    ),
  );
const retiredError = () =>
  Error(
    t(
      'Google Drive への直接接続は終了しました。このコンピューターのフォルダに切り替えてください。',
      'Connecting to Google Drive directly has ended. Switch to a folder on this computer.',
    ),
  );
type Mounted = {
  attachment: LocalAttachment;
  /** Where the connection appears: `contents/<name>` in its hibachi. */
  entry: string;
  /** Where its files are: the chosen local folder. */
  target: string;
  /** The identity of `target`, checked before each use. */
  device: number;
  inode: number;
  /** The link at `entry`, as irori made it. */
  link: { device: number; inode: number };
  /** Files may be changed: the connection allows it. */
  writable: boolean;
};
/**
 * The folders in a hibachi's contents. Each is a folder on this device, often one
 * a sync app (Drive for desktop, Dropbox, Box, iCloud, OneDrive) keeps, shown at
 * `contents/<name>` through a link (ADR 019). Google Drive connections irori made
 * itself before 0.1.67 are listed as retired, to be switched to such a folder
 * (ADR 023).
 */
export class CloudService {
  private queue = new SerialQueue();
  private mounted = new Map<string, Mounted>();
  // Each owner's root, as last read, so writability can be answered without I/O.
  private roots = new Map<string, string>();
  private states = new Map<string, { state: CloudConnection['state']; detail?: string }>();
  private stopping = false;
  constructor(
    private files: CloudStorage,
    /** Moves a local folder's file to the system trash; without it, nothing local is deleted. */
    private trash?: (filename: string) => Promise<void>,
  ) {}
  get busy() {
    return this.queue.busy;
  }
  private key(scopeId: string, mountId: string) {
    return `${scopeId}:${mountId}`;
  }
  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    if (this.stopping)
      return Promise.reject(
        Error(t('クラウドサービスは終了中です。', 'The cloud service is stopping.')),
      );
    return this.queue.run(fn);
  }
  private declarationFile(scopeId: string) {
    return this.metadataFile(scopeId, 'cloud-mounts.json');
  }
  private async metadataFile(scopeId: string, name: string) {
    const space = await this.files.get(scopeId);
    const dir = await this.files.resolve(scopeId, '.irori');
    if (dir !== path.join(space.root, '.irori'))
      throw Error('Cloud metadata directory must not be an alias');
    const filename = path.join(dir, name);
    try {
      if ((await fs.lstat(filename)).isSymbolicLink())
        throw Error('Cloud metadata must not be a symlink');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return filename;
  }
  async declarations(scopeId: string): Promise<CloudAttachment[]> {
    const space = await this.files.get(scopeId);
    let records: CloudAttachment[];
    try {
      records = z
        .array(cloudDeclaration)
        .max(100)
        .parse(await readLocalJson(await this.declarationFile(scopeId), []));
    } catch (error) {
      // Parser output names positions and schema paths, not what the person can do.
      if (!(error instanceof SyntaxError || error instanceof z.ZodError)) throw error;
      throw Error(
        t(
          `「${space.name}」の Drive 接続の記録（.irori/cloud-mounts.json）を読み取れません。`,
          `Cannot read the Drive connection record (.irori/cloud-mounts.json) of "${space.name}".`,
        ),
      );
    }
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const record of records) {
      const name = nameKey(`${record.contentsRoot}/${record.name}`);
      if (
        record.scopeId !== scopeId ||
        !space.contents.includes(record.contentsRoot) ||
        ids.has(record.mountId) ||
        paths.has(name)
      )
        throw Error(
          t(
            'クラウド接続宣言の識別情報またはパスが重複・不一致です。',
            'A cloud connection declaration has a duplicate or mismatched identity or path.',
          ),
        );
      ids.add(record.mountId);
      paths.add(name);
    }
    return records;
  }
  /** Folders on this device, then retired Drive connections waiting to be switched. */
  async connections(scopeId: string): Promise<CloudConnection[]> {
    const local = await this.localDeclarations(scopeId);
    return [
      ...(await Promise.all(
        local.map(async (record) => {
          const key = this.key(scopeId, record.mountId);
          await this.refresh(key);
          const binding = await this.localBinding(scopeId, record.mountId);
          const current = this.mounted.get(key);
          return {
            ...record,
            ...(this.states.get(key) ?? {
              state: binding ? ('disconnected' as const) : ('unconfigured' as const),
            }),
            ...(current ? { writable: current.writable } : {}),
          };
        }),
      )),
      ...(await this.declarations(scopeId)).map((record) => ({
        ...record,
        state: 'retired' as const,
        detail: t(
          'Google Drive への直接接続は終了しました',
          'Direct Google Drive connection ended',
        ),
      })),
    ];
  }
  /** Marks a mounted connection lost when its mount or link no longer checks out. */
  private async refresh(key: string) {
    const mounted = this.mounted.get(key);
    if (!mounted) return;
    try {
      await this.assertLinked(mounted);
      if (this.mounted.get(key) === mounted) this.states.set(key, { state: 'mounted' });
    } catch {
      if (this.mounted.get(key) === mounted)
        this.states.set(key, {
          state: 'error',
          detail: t(
            '接続が失われました。再接続してください。',
            'The connection was lost. Connect again.',
          ),
        });
    }
  }
  private async parent(record: Pick<Attachment, 'scopeId' | 'contentsRoot'>, create = false) {
    const space = await this.files.get(record.scopeId);
    if (!space.contents.includes(record.contentsRoot))
      throw Error('Declared contents root required');
    let current = space.root;
    for (const part of record.contentsRoot.split('/')) {
      if (!part || part === '.' || part === '..' || part.includes('\\'))
        throw Error('Invalid contents root');
      current = path.join(current, part);
      const roots = await this.files.list();
      if (
        owner([...roots.filter((root) => root.scopeId !== space.scopeId), space], current)
          ?.scopeId !== space.scopeId
      )
        throw Error('Contents belongs to another scope');
      let stat;
      try {
        stat = await fs.lstat(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (!create) return undefined;
        await fs.mkdir(current, { mode: 0o700 });
        stat = await fs.lstat(current);
      }
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Error(
          t(
            'contentsの親フォルダにリンクやファイルがあります。',
            'The parent folder of contents contains a link or a file.',
          ),
        );
    }
    return current;
  }
  private async checkVacant(record: Attachment) {
    const parent = await this.parent(record);
    if (!parent) return;
    const siblings = await fs.readdir(parent);
    if (siblings.some((name) => nameKey(name) === nameKey(record.name)))
      throw Error(
        t(
          '同じ名前のフォルダ・ファイルまたは接続先があります。',
          'A folder, file or connection with the same name exists.',
        ),
      );
  }
  private retiredBindingFile(scopeId: string, mountId: string) {
    return path.join(this.files.dataDir, 'cloud-bindings', `${scopeId}-${mountId}.json`);
  }
  /**
   * Removes the empty folder irori made as a retired Drive connection's mount point,
   * when it is still that folder. Anything else at that place stays.
   */
  private async releasePlaceholder(record: CloudAttachment) {
    const parent = await this.parent(record);
    if (!parent) return;
    const parsed = retiredBindingSchema.safeParse(
      await readLocalJson(this.retiredBindingFile(record.scopeId, record.mountId), null).catch(
        () => null,
      ),
    );
    const placeholder = parsed.success ? parsed.data.placeholder : undefined;
    const target = path.join(parent, record.name);
    const info = await fs.lstat(target).catch(() => undefined);
    if (
      !placeholder ||
      !info?.isDirectory() ||
      info.isSymbolicLink() ||
      info.dev !== placeholder.dev ||
      info.ino !== placeholder.ino
    )
      return;
    await fs.chmod(target, 0o700);
    try {
      await fs.rmdir(target);
    } catch (error) {
      await fs.chmod(target, info.mode & 0o777);
      if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? ''))
        throw error;
    }
  }
  /** Drops a retired Drive connection's records; its files stay in Drive. */
  private async forgetRetired(record: CloudAttachment) {
    const records = await this.declarations(record.scopeId);
    await this.releasePlaceholder(record);
    await writeLocalJson(
      await this.declarationFile(record.scopeId),
      records.filter((item) => item.mountId !== record.mountId),
    );
    await fs.rm(this.retiredBindingFile(record.scopeId, record.mountId), { force: true });
  }
  /**
   * Switches a retired Drive connection to a folder on this device, usually the
   * same Drive folder as Drive for desktop keeps it. Its name and place in contents
   * stay, so pages that point at `contents/<name>/...` still find their files.
   */
  switchToLocal(scopeId: string, mountId: string, chosen: string) {
    return this.mutate(async () => {
      const record = (await this.declarations(scopeId)).find((item) => item.mountId === mountId);
      if (!record) throw Error('Unknown cloud connection');
      const space = await this.files.get(scopeId);
      const target = await this.localTarget(chosen);
      const records = await this.localDeclarations(scopeId);
      const local = localDeclaration.parse({
        schemaVersion: 1,
        mountId: record.mountId,
        scopeId,
        provider: 'local',
        folderName: path.basename(target) || target,
        contentsRoot: record.contentsRoot,
        name: record.name,
        access: record.access,
      });
      if (records.some((item) => item.mountId === mountId))
        throw Error('Duplicate cloud connection identity');
      await this.forgetRetired(record);
      await writeLocalJson(await this.metadataFile(scopeId, 'local-folders.json'), [
        ...records,
        local,
      ]);
      await writeLocalJson(this.localBindingFile(scopeId, mountId), {
        scopeId,
        mountId,
        root: space.root,
        path: target,
      });
      this.states.delete(this.key(scopeId, mountId));
    });
  }
  /** Renames a folder connection, or unregisters a connection of either kind when no name is given. */
  edit(scopeId: string, mountId: string, name?: string) {
    return this.mutate(async () => {
      const key = this.key(scopeId, mountId);
      if (this.mounted.has(key))
        throw Error(
          t(
            '接続を解除してから名前変更・登録解除してください。',
            'Disconnect before renaming or unregistering.',
          ),
        );
      const local = (await this.localDeclarations(scopeId)).find(
        (item) => item.mountId === mountId,
      );
      if (local) return this.editLocal(local, name);
      const record = (await this.declarations(scopeId)).find((item) => item.mountId === mountId);
      if (!record) throw Error('Unknown cloud connection');
      if (name !== undefined) throw retiredError();
      await this.forgetRetired(record);
      this.states.delete(key);
    });
  }
  async localDeclarations(scopeId: string): Promise<LocalAttachment[]> {
    const space = await this.files.get(scopeId);
    let records: LocalAttachment[];
    try {
      records = z
        .array(localDeclaration)
        .max(100)
        .parse(await readLocalJson(await this.metadataFile(scopeId, 'local-folders.json'), []));
    } catch (error) {
      if (!(error instanceof SyntaxError || error instanceof z.ZodError)) throw error;
      throw Error(
        t(
          `「${space.name}」のフォルダ接続の記録（.irori/local-folders.json）を読み取れません。`,
          `Cannot read the folder connection record (.irori/local-folders.json) of "${space.name}".`,
        ),
      );
    }
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const record of records) {
      const name = nameKey(`${record.contentsRoot}/${record.name}`);
      if (
        record.scopeId !== scopeId ||
        !space.contents.includes(record.contentsRoot) ||
        ids.has(record.mountId) ||
        paths.has(name)
      )
        throw Error(
          t(
            'フォルダ接続の記録の識別情報またはパスが重複・不一致です。',
            'A folder connection record has a duplicate or mismatched identity or path.',
          ),
        );
      ids.add(record.mountId);
      paths.add(name);
    }
    return records;
  }
  /** Refuses a name another connection of either kind already uses in that contents folder. */
  private async assertNameFree(record: Attachment) {
    const key = nameKey(`${record.contentsRoot}/${record.name}`);
    const others = [
      ...(await this.declarations(record.scopeId)),
      ...(await this.localDeclarations(record.scopeId)),
    ];
    if (
      others.some(
        (item) =>
          item.mountId !== record.mountId && nameKey(`${item.contentsRoot}/${item.name}`) === key,
      )
    )
      throw Error(t('同じ名前の接続先があります。', 'A connection with the same name exists.'));
  }
  private localBindingFile(scopeId: string, mountId: string) {
    return path.join(this.files.dataDir, 'local-bindings', `${scopeId}-${mountId}.json`);
  }
  private async localBinding(scopeId: string, mountId: string): Promise<LocalBinding | undefined> {
    const value = await readLocalJson(this.localBindingFile(scopeId, mountId), null);
    if (!value) return;
    const binding = localBindingSchema.parse(value);
    if (
      binding.scopeId !== scopeId ||
      binding.mountId !== mountId ||
      binding.root !== (await this.files.get(scopeId)).root
    )
      return;
    return binding;
  }
  /**
   * The folder a local connection may use: an existing directory, by its real path,
   * that neither holds nor lies inside a hibachi or irori's own data. A hibachi in
   * it would appear inside another's contents, and irori's data is not material.
   */
  private async localTarget(chosen: string) {
    const missing = () => Error(t('フォルダが見つかりません。', 'The folder was not found.'));
    if (!path.isAbsolute(chosen)) throw missing();
    let target: string;
    try {
      target = await fs.realpath(chosen);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw missing();
      // A sync app's virtual drive may not report a final path; the chosen one is used.
      target = path.resolve(chosen);
    }
    const info = await fs.lstat(target).catch(() => {
      throw missing();
    });
    if (!info.isDirectory() || info.isSymbolicLink()) throw missing();
    const overlaps = (a: string, b: string) => within(a, b) || within(b, a);
    for (const root of [
      ...(await this.files.list()).map((item) => item.root),
      this.files.dataDir,
    ]) {
      const actual = await fs.realpath(root).catch(() => root);
      if (overlaps(root, target) || overlaps(actual, target))
        throw Error(
          t(
            'hibachi や irori のデータと重なるフォルダは選べません。',
            "This folder overlaps a hibachi or irori's data.",
          ),
        );
    }
    return target;
  }
  /** Registers a folder on this device; it appears in contents once connected. */
  addLocal(input: AddLocalFolder) {
    return this.mutate(async () => {
      const error = mountNameError(input.name);
      if (error) throw Error(error);
      const space = await this.files.get(input.scopeId);
      if (!space.contents.includes(input.contentsRoot))
        throw Error(
          t('contentsの登録先を選択してください。', 'Choose where in contents to register it.'),
        );
      const records = await this.localDeclarations(input.scopeId);
      if (records.length >= 100)
        throw Error(
          t(
            '接続先は1スペースにつき100件まで登録できます。',
            'Each space can register up to 100 connections.',
          ),
        );
      const target = await this.localTarget(input.path);
      const record = localDeclaration.parse({
        schemaVersion: 1,
        mountId: randomUUID(),
        scopeId: input.scopeId,
        provider: 'local',
        folderName: path.basename(target) || target,
        contentsRoot: input.contentsRoot,
        name: input.name,
        access: input.access ?? 'read-write',
      });
      await this.assertNameFree(record);
      await this.checkVacant(record);
      await writeLocalJson(await this.metadataFile(input.scopeId, 'local-folders.json'), [
        ...records,
        record,
      ]);
      await writeLocalJson(this.localBindingFile(record.scopeId, record.mountId), {
        scopeId: record.scopeId,
        mountId: record.mountId,
        root: space.root,
        path: target,
      });
      return (await this.connections(record.scopeId)).find(
        (item) => item.mountId === record.mountId,
      )!;
    });
  }
  /** Chooses the folder a local connection uses on this device, for example after a move. */
  bindLocal(scopeId: string, mountId: string, chosen: string) {
    return this.mutate(async () => {
      const key = this.key(scopeId, mountId);
      if (this.mounted.has(key))
        throw Error(
          t(
            '接続を解除してからフォルダを選び直してください。',
            'Disconnect before choosing again.',
          ),
        );
      const records = await this.localDeclarations(scopeId);
      const record = records.find((item) => item.mountId === mountId);
      if (!record) throw Error('Unknown cloud connection');
      const target = await this.localTarget(chosen);
      await this.dropStaleLink(record);
      await writeLocalJson(this.localBindingFile(scopeId, mountId), {
        scopeId,
        mountId,
        root: (await this.files.get(scopeId)).root,
        path: target,
      });
      const folderName = path.basename(target) || target;
      if (folderName !== record.folderName)
        await this.writeLocal(
          scopeId,
          records,
          records.map((item) => (item.mountId === mountId ? { ...item, folderName } : item)),
        );
      this.states.delete(key);
    });
  }
  private async writeLocal(scopeId: string, before: LocalAttachment[], after: LocalAttachment[]) {
    if (JSON.stringify(await this.localDeclarations(scopeId)) !== JSON.stringify(before))
      throw Error(
        t(
          '接続情報が外部で変更されました。再読み込みしてください。',
          'The connection information changed outside irori. Reload it.',
        ),
      );
    await writeLocalJson(await this.metadataFile(scopeId, 'local-folders.json'), after);
  }
  /** Renames a local connection, or unregisters it when no name is given. It must not be connected. */
  private async editLocal(record: LocalAttachment, name?: string) {
    const { scopeId, mountId } = record;
    const records = await this.localDeclarations(scopeId);
    let replacement: LocalAttachment | undefined;
    if (name !== undefined) {
      const error = mountNameError(name);
      if (error) throw Error(error);
      if (name === record.name) return;
      replacement = { ...record, name };
      await this.assertNameFree(replacement);
      await this.checkVacant(replacement);
    }
    await this.dropStaleLink(record);
    await this.writeLocal(
      scopeId,
      records,
      records.flatMap((item) =>
        item.mountId !== mountId ? [item] : replacement ? [replacement] : [],
      ),
    );
    if (!replacement) await fs.rm(this.localBindingFile(scopeId, mountId), { force: true });
    this.states.delete(this.key(scopeId, mountId));
  }
  private async setLocalAccess(record: LocalAttachment, access: CloudAccess) {
    if (record.access === access) return;
    const { scopeId, mountId } = record;
    const wasMounted = this.mounted.has(this.key(scopeId, mountId));
    if (wasMounted) await this.unmount(scopeId, mountId);
    const records = await this.localDeclarations(scopeId);
    await this.writeLocal(
      scopeId,
      records,
      records.map((item) => (item.mountId === mountId ? { ...item, access } : item)),
    );
    if (wasMounted) await this.mount(scopeId, mountId);
  }
  /** Whether the link at `entry` leads to `target`. */
  private async pointsTo(entry: string, target: string) {
    const value = await fs.readlink(entry).catch(() => undefined);
    if (value === undefined) return false;
    // Windows reports a junction's target with its \\?\ prefix.
    const normal = (item: string) => {
      const resolved = path.resolve(path.dirname(entry), item.replace(/^\\\\\?\\/, ''));
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    return normal(value) === normal(target);
  }
  /**
   * Shows a local folder at `contents/<name>` through a link (a junction on Windows),
   * so the person's tools and CLI agents find it there. irori itself reaches it only
   * through `locate`, which checks the link and the folder first.
   */
  private async link(record: LocalAttachment) {
    const { scopeId, mountId } = record;
    const key = this.key(scopeId, mountId);
    const current = this.mounted.get(key);
    if (current) {
      try {
        await this.assertLinked(current);
        this.states.set(key, { state: 'mounted' });
        return;
      } catch {
        this.mounted.delete(key);
      }
    }
    const binding = await this.localBinding(scopeId, mountId);
    if (!binding)
      throw Error(t('この端末のフォルダを選んでください。', 'Choose the folder on this device.'));
    this.states.set(key, { state: 'connecting' });
    let made: string | undefined;
    try {
      const target = await this.localTarget(binding.path);
      const folder = await fs.lstat(target);
      const entry = path.join((await this.parent(record, true))!, record.name);
      const existing = await fs.lstat(entry).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      });
      // A link irori left when it last stopped without disconnecting is used again.
      if (!(existing?.isSymbolicLink() && (await this.pointsTo(entry, target)))) {
        await this.checkVacant(record);
        await fs.symlink(target, entry, process.platform === 'win32' ? 'junction' : 'dir');
        made = entry;
      }
      const link = await fs.lstat(entry);
      const mounted: Mounted = {
        attachment: record,
        entry,
        target,
        device: folder.dev,
        inode: folder.ino,
        link: { device: link.dev, inode: link.ino },
        writable: record.access === 'read-write',
      };
      await this.assertLinked(mounted);
      this.mounted.set(key, mounted);
      this.states.set(key, { state: 'mounted' });
    } catch (error) {
      if (made) await fs.unlink(made).catch(() => {});
      this.states.set(key, { state: 'error', detail: (error as Error).message });
      throw error;
    }
  }
  private async assertLinked(mounted: Mounted) {
    const changed = () =>
      Error(t('フォルダの識別情報が変わりました。', 'The identity of the folder has changed.'));
    const [link, folder] = await Promise.all([
      fs.lstat(mounted.entry),
      fs.lstat(mounted.target),
    ]).catch(() => {
      throw Error(t('フォルダが見つかりません。', 'The folder was not found.'));
    });
    if (
      !link.isSymbolicLink() ||
      link.dev !== mounted.link?.device ||
      link.ino !== mounted.link.inode ||
      !folder.isDirectory() ||
      folder.isSymbolicLink() ||
      folder.dev !== mounted.device ||
      folder.ino !== mounted.inode ||
      !(await this.pointsTo(mounted.entry, mounted.target))
    )
      throw changed();
  }
  /** Removes irori's link to a local folder; anything that replaced it stays. */
  private async unlink(record: LocalAttachment, target: string) {
    const entry = path.join((await this.parent(record))!, record.name);
    const info = await fs.lstat(entry).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (info?.isSymbolicLink() && (await this.pointsTo(entry, target))) await fs.unlink(entry);
  }
  /** Removes a link a stop without disconnecting left behind, before a rename or removal. */
  private async dropStaleLink(record: LocalAttachment) {
    const binding = await this.localBinding(record.scopeId, record.mountId);
    if (binding && (await this.parent(record))) await this.unlink(record, binding.path);
  }
  /** The local folders connected in a hibachi, for CLI agents to be allowed into. */
  localFolders(scopeId: string) {
    return [...this.mounted.values()]
      .filter((item) => item.attachment.scopeId === scopeId && item.attachment.provider === 'local')
      .map((item) => item.target);
  }
  connect(scopeId: string, mountId: string) {
    return this.mutate(() => this.mount(scopeId, mountId));
  }
  private async mount(scopeId: string, mountId: string) {
    const local = (await this.localDeclarations(scopeId)).find((item) => item.mountId === mountId);
    if (local) return this.link(local);
    if ((await this.declarations(scopeId)).some((item) => item.mountId === mountId))
      throw retiredError();
    throw Error('Unknown cloud connection');
  }
  disconnect(scopeId: string, mountId: string) {
    return this.mutate(() => this.unmount(scopeId, mountId));
  }
  /** Whether a connection may change its folder; a connected folder is linked again. */
  setAccess(scopeId: string, mountId: string, access: CloudAccess) {
    return this.mutate(async () => {
      const local = (await this.localDeclarations(scopeId)).find(
        (item) => item.mountId === mountId,
      );
      if (local) return this.setLocalAccess(local, access);
      if ((await this.declarations(scopeId)).some((item) => item.mountId === mountId))
        throw retiredError();
      throw Error('Unknown cloud connection');
    });
  }
  /** The folder a connection is mounted on, for the system file manager. */
  async folder(scopeId: string, mountId: string) {
    const mounted = this.mounted.get(this.key(scopeId, mountId));
    if (!mounted)
      throw Error(t('クラウドフォルダは未接続です。', 'The cloud folder is not connected.'));
    await this.assertLinked(mounted);
    return mounted.target;
  }
  /** Whether a path lies inside a folder mounted so that it can be changed. */
  writable(scopeId: string, rel: string) {
    const root = this.roots.get(scopeId);
    if (!root) return false;
    const target = path.join(root, rel);
    return [...this.mounted.values()].some(
      (item) => item.attachment.scopeId === scopeId && item.writable && within(item.entry, target),
    );
  }
  private async assertWritable(scopeId: string, rel: string) {
    await this.rootOf(scopeId);
    if (!this.writable(scopeId, rel))
      throw Error(
        t(
          'このクラウドフォルダは読み取り専用で接続されています。',
          'This cloud folder is connected read-only.',
        ),
      );
  }
  private async rootOf(scopeId: string) {
    const root = (await this.files.get(scopeId)).root;
    this.roots.set(scopeId, root);
    return root;
  }
  /** Writes an edited text file in place, keeping the previous version on this device. */
  write(doc: Document) {
    return this.mutate(async () => {
      if (Buffer.byteLength(doc.text, 'utf8') > textFileByteLimit)
        throw Error('The text editor supports files up to 2 MiB');
      if (doc.text.includes('\0')) throw Error('Binary files cannot be edited as text');
      const { filename } = await this.locate(doc.scopeId, doc.path);
      await this.assertWritable(doc.scopeId, doc.path);
      const conflict = () =>
        Error(
          t(
            'CONFLICT: ディスク上の変更を確認してください。',
            'CONFLICT: Check the changes on disk.',
          ),
        );
      const before = await fs.readFile(filename);
      if (hash(before) !== doc.hash) throw conflict();
      if (hash(doc.text) === doc.hash) return;
      await writeLocalFile(
        path.join(this.files.dataDir, `backup-${hash(before)}.txt`),
        before.toString('utf8'),
      );
      if (hash(await fs.readFile(filename)) !== doc.hash) throw conflict();
      // Written in place, so a sync app sends a new version of the same file.
      await fs.writeFile(filename, doc.text);
    });
  }
  /**
   * A file in a connected folder, with whether it may be edited and any kept draft.
   * A format irori shows with a viewer opens view-only, without a draft.
   */
  async document(scopeId: string, rel: string): Promise<Document> {
    const root = await this.files.get(scopeId);
    this.roots.set(scopeId, root.root);
    const doc = await readDocument(await this.resolve(scopeId, rel), scopeId, rel);
    const writable = this.writable(scopeId, rel);
    const draft =
      writable && !doc.viewer
        ? await readLocalJson(draftFile(this.files.dataDir, scopeId, rel), null)
        : null;
    return {
      ...doc,
      readOnly: !writable,
      cloud: true,
      ...(draft
        ? { draft: z.object({ text: z.string(), baseHash: z.string() }).parse(draft) }
        : {}),
    };
  }
  /** A path inside a verified folder that may be changed, with the folder it lies in. */
  private async editable(scopeId: string, rel: string) {
    const actual = await this.resolve(scopeId, rel);
    await this.assertWritable(scopeId, rel);
    const mounted = [...this.mounted.values()].find(
      (item) => item.attachment.scopeId === scopeId && within(item.target, actual),
    )!;
    if (actual === mounted.target) throw connectionFolderError();
    return { actual, mounted };
  }
  /**
   * Renames or moves a file or folder inside one editable connection, in place, so
   * a sync app sees a rename rather than a new file. `to` is the full new path; an
   * existing entry is never replaced, and neither is a name that differs only in
   * case or normalization.
   */
  moveEntry(scopeId: string, from: string, to: string): Promise<Entry> {
    return this.mutate(async () => {
      const { actual, mounted } = await this.editable(scopeId, from);
      assertCloudPath(to);
      const name = path.posix.basename(to);
      const invalid = entryNameError(name);
      if (invalid) throw Error(invalid);
      const info = await fs.lstat(actual);
      const directory = path.posix.dirname(to);
      if (!within(mounted.entry, path.join(await this.rootOf(scopeId), directory)))
        throw Error(
          t(
            '同じ接続フォルダの中にだけ移動できます。',
            'An entry can only be moved within its own connected folder.',
          ),
        );
      let parent: string;
      try {
        parent = await this.resolve(scopeId, directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        throw Error(t('移動先のフォルダがありません。', 'The destination folder does not exist.'));
      }
      if (!(await fs.stat(parent)).isDirectory())
        throw Error(
          t('移動先にはフォルダを指定してください。', 'Choose a folder as the destination.'),
        );
      if (info.isDirectory() && within(actual, parent))
        throw Error(
          t(
            'フォルダを自分自身やその中のフォルダには移動できません。',
            'A folder cannot be moved into itself or into one of its own folders.',
          ),
        );
      const destination = path.join(parent, name);
      const key = nameKey(name);
      if (
        (await fs.readdir(parent)).some(
          (item) => nameKey(item) === key && path.join(parent, item) !== actual,
        )
      )
        throw Error(
          t(
            '同じ名前のファイルまたはフォルダがあります。',
            'A file or folder with the same name exists.',
          ),
        );
      if (destination !== actual) {
        if (path.dirname(actual) === parent && nameKey(path.basename(actual)) === key) {
          // Only the case or the normalization of the name changes. A case-insensitive
          // mount can take both names for one entry, so go through a name it tells apart.
          const temporary = path.join(parent, `${name}.irori-${randomUUID().slice(0, 8)}`);
          await fs.rename(actual, temporary);
          try {
            await fs.rename(temporary, destination);
          } catch (error) {
            await fs.rename(temporary, actual).catch(() => {});
            throw error;
          }
        } else await fs.rename(actual, destination);
        // A kept draft follows its file. Drafts are found by a hash of the path, so
        // those of files inside a moved folder stay under their old paths: the open
        // document is saved before a move, so at most a conflict draft is left behind.
        if (info.isFile()) await this.moveDraft(scopeId, from, to);
      }
      return {
        path: to,
        name,
        directory: info.isDirectory(),
        layer: 'contents',
        note: /\.md$/i.test(name),
        writable: true,
      };
    });
  }
  private async moveDraft(scopeId: string, from: string, to: string) {
    const destination = draftFile(this.files.dataDir, scopeId, to);
    // A draft already under the new path belonged to a file that is gone.
    await fs.rm(destination, { force: true });
    await fs
      .rename(draftFile(this.files.dataDir, scopeId, from), destination)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
  }
  /** Moves a file or folder of an editable connection to the system trash. */
  deleteEntry(scopeId: string, target: string): Promise<void> {
    return this.mutate(async () => {
      const { actual } = await this.editable(scopeId, target);
      // A plain folder has no Drive trash behind it: the system's trash keeps the entry.
      if (!this.trash) throw Error(t('ごみ箱を使えません。', 'The trash is not available.'));
      await this.trash(actual);
      await fs.rm(draftFile(this.files.dataDir, scopeId, target), { force: true });
    });
  }
  /** Adds an empty Markdown note to an editable connected folder; an existing file is never replaced. */
  createNote(scopeId: string, directory: string, name: string) {
    return this.mutate(async () => {
      const filename = noteFilename(name);
      const folder = await this.resolve(scopeId, directory);
      await this.assertWritable(scopeId, directory);
      if (!(await fs.stat(folder)).isDirectory()) throw Error('Choose a folder for the new note');
      await fs.writeFile(path.join(folder, filename), `# ${filename.slice(0, -3)}\n\n`, {
        flag: 'wx',
      });
      return this.document(scopeId, `${directory}/${filename}`);
    });
  }
  private async unmount(scopeId: string, mountId: string) {
    const key = this.key(scopeId, mountId);
    const mounted = this.mounted.get(key);
    if (mounted) {
      await this.unlink(mounted.attachment, mounted.target);
      this.mounted.delete(key);
    }
    this.states.set(key, { state: 'disconnected' });
  }
  async resolve(scopeId: string, rel: string) {
    return (await this.locate(scopeId, rel)).filename;
  }
  /** The verified mount holding a path, and the path's location on it. */
  private async locate(scopeId: string, rel: string) {
    assertCloudPath(rel);
    const target = path.join(await this.rootOf(scopeId), rel);
    const entry = [...this.mounted.values()].find(
      (item) => item.attachment.scopeId === scopeId && within(item.entry, target),
    );
    if (!entry)
      throw Error(t('クラウドフォルダは未接続です。', 'The cloud folder is not connected.'));
    await this.assertLinked(entry);
    // The mount point's identity is verified above; below it no component may be
    // a link, checked one component at a time as parent() does above it. realpath
    // cannot be used: on Windows a WinFsp volume mounted on a folder has no DOS
    // name, so GetFinalPathNameByHandleW fails and Node reports UNKNOWN for every
    // path inside the mount.
    // A local folder's link is followed only here, to the folder verified above.
    let actual = entry.target;
    for (const part of path.relative(entry.entry, target).split(path.sep).filter(Boolean)) {
      actual = path.join(actual, part);
      if ((await fs.lstat(actual)).isSymbolicLink())
        throw Error('Cloud path alias escapes its mount');
    }
    return { mounted: entry, filename: actual };
  }
  async rootEntries(scopeId: string, rel: string): Promise<Entry[] | undefined> {
    const space = await this.files.get(scopeId);
    if (!space.contents.includes(rel)) return;
    const entries: Entry[] = (await this.connections(scopeId))
      .filter((record) => record.contentsRoot === rel)
      .map((record) => ({
        path: `${rel}/${record.name}`,
        name: record.name,
        directory: true,
        layer: 'contents',
        note: false,
        blocked:
          record.state === 'mounted' ? undefined : (record.detail ?? t('未接続', 'Not connected')),
        ...(record.state === 'mounted' && record.writable ? { writable: true } : {}),
        connection: true,
        ...(record.provider === 'local' ? { local: true } : {}),
      }));
    const parent = await this.parent({ scopeId, contentsRoot: rel });
    if (parent)
      for (const item of await fs.readdir(parent, { withFileTypes: true })) {
        if (!entries.some((entry) => nameKey(entry.name) === nameKey(item.name)))
          entries.push({
            path: `${rel}/${item.name}`,
            name: item.name,
            directory: item.isDirectory(),
            layer: 'contents',
            note: false,
            blocked: t('登録されていないローカルデータです。', 'Unregistered local data.'),
          });
      }
    return entries;
  }
  async close() {
    this.stopping = true;
    try {
      await this.queue.idle();
      for (const mounted of this.mounted.values())
        await this.unmount(mounted.attachment.scopeId, mounted.attachment.mountId);
    } catch (error) {
      this.stopping = false;
      throw error;
    }
  }
}
