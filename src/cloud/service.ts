import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SerialQueue } from '../host/serial-queue';
import { CloudAccounts } from './accounts';
import type { GoogleOAuth } from './oauth';
import { Rclone, type RcloneAPI } from './rclone';
import { cloudDeclaration, entryNameError, mountNameError, nameKey } from '../domain/connections';
import { owner, within } from '../domain/scopes';
import { readLocalJson, writeLocalFile, writeLocalJson } from '../host/local-json';
import { draftFile, hash, readTextDocument, textFileByteLimit } from '../host/files';
import { noteFilename } from '../domain/note-operations';
import type { CloudStorage } from './storage';
import type { WriteTarget } from './outbox';
import { uploadErrorMessage, type UploadErrorCategory } from './upload-errors';
import type {
  AddCloudAttachment,
  CloudAccess,
  CloudAttachment,
  CloudConnection,
  CloudSetup,
  Document,
  Entry,
} from '../domain/types';
import { t } from '../domain/i18n';

const bindingSchema = z.object({
  scopeId: z.uuid(),
  mountId: z.uuid(),
  root: z.string(),
  accountId: z.uuid(),
  placeholder: z.object({ dev: z.number(), ino: z.number() }).optional(),
});
type Binding = z.infer<typeof bindingSchema>;
/** Settles with the promise, or rejects once `ms` have passed. */
function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error('Timed out')), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}
// rclone's upload queue (vfs/rc.go `vfs/queue`): `tries` counts the upload attempts
// made for an item, including one in progress.
const queueSchema = z.object({
  queue: z
    .array(
      z.object({
        name: z.string(),
        tries: z.number().optional(),
        uploading: z.boolean().optional(),
      }),
    )
    .nullish()
    .transform((items) => items ?? []),
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
      '接続フォルダ自体はここでは変更できません。名前の変更や登録解除は「クラウド接続」から行ってください。',
      'The connection folder itself is not changed here. Rename or unregister it from "Cloud connection".',
    ),
  );
type Mounted = {
  attachment: CloudAttachment;
  target: string;
  device: number;
  inode: number;
  filesystem: string;
  /** The fs spec the folder was mounted with, for asking Drive directly, past the mount's cache. */
  remote: Record<string, string>;
  /** Mounted so that files can be changed: the connection allows it and so does its account. */
  writable: boolean;
};
export class CloudService {
  readonly accounts: CloudAccounts;
  private queue = new SerialQueue();
  private mounted = new Map<string, Mounted>();
  // Each owner's root, as last read, so writability can be answered without I/O.
  private roots = new Map<string, string>();
  private states = new Map<string, { state: CloudConnection['state']; detail?: string }>();
  private stopping = false;
  constructor(
    private files: CloudStorage,
    openBrowser: (url: string) => Promise<void>,
    private rpc: RcloneAPI = new Rclone(files.dataDir),
    oauth?: GoogleOAuth,
  ) {
    this.accounts = new CloudAccounts(files.dataDir, rpc, openBrowser, oauth);
  }
  get busy() {
    return this.queue.busy;
  }
  async workspaceRoot(id: string) {
    const root = await this.files.get(id);
    if (!root.workspace) throw Error('Select a workspace for this operation');
    return root;
  }
  removeWorkspace(id: string, remove: () => Promise<void>) {
    return this.mutate(async () => {
      await this.workspaceRoot(id);
      if ((await this.declarations(id)).length)
        throw Error(
          t(
            'このワークスペースの Drive 接続を登録解除してから削除してください。KB と Drive のファイルは残ります。',
            "Unregister this workspace's Drive connections before removing it. The KB and Drive files stay.",
          ),
        );
      await remove();
    });
  }
  async isWorkspacePath(root: string) {
    for (const item of await this.files.list()) {
      if (!item.workspace) continue;
      const actual = await fs.realpath(item.root).catch(() => item.root);
      if (within(actual, root)) return true;
    }
    return false;
  }
  addAccount(name: string) {
    return this.mutate(() => this.accounts.add(name));
  }
  cancelAccount(id: string) {
    return this.mutate(() => this.accounts.cancel(id));
  }
  removeAccount(id: string) {
    return this.mutate(async () => {
      // Include bindings belonging to offline scopes, not just the current workspace.
      const directory = path.join(this.files.dataDir, 'cloud-bindings');
      const names = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return [];
      });
      for (const name of names.filter((name) => name.endsWith('.json'))) {
        const binding = bindingSchema.parse(await readLocalJson(path.join(directory, name), null));
        if (binding.accountId === id)
          throw Error(
            t(
              'このアカウントを使う接続先があります。各スペースで登録解除するか、別のアカウントに紐づけてください。',
              'Some connections use this account. Unregister them in each space or link them to another account.',
            ),
          );
      }
      await this.accounts.remove(id);
    });
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
  async setup(): Promise<CloudSetup> {
    try {
      const version = await this.rpc.call('core/version');
      const types = await this.rpc.call('mount/types');
      let mountAvailable = Array.isArray(types.mountTypes) && types.mountTypes.length > 0;
      let detail = t(
        'クラウドフォルダは読み取り専用で接続します。',
        'Cloud folders connect read-only.',
      );
      let prerequisite: CloudSetup['prerequisite'];
      if (!mountAvailable)
        detail = t(
          'このrcloneには利用できるマウント機能がありません。接続先の登録は可能です。',
          'This rclone has no usable mount support. Connections can still be registered.',
        );
      if (process.platform === 'linux') {
        try {
          await fs.access('/dev/fuse');
        } catch {
          mountAvailable = false;
          prerequisite = 'fuse';
          detail = t(
            'この環境にはFUSEがありません。フォルダ選択・登録は可能ですが、マウントにはFUSEが必要です。',
            'FUSE is not available here. You can still choose and register folders, but mounting needs FUSE.',
          );
        }
      } else if (process.platform === 'win32') {
        try {
          await fs.access(
            path.join(
              process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
              'WinFsp',
              'bin',
            ),
          );
        } catch {
          mountAvailable = false;
          prerequisite = 'winfsp';
          detail = t(
            'フォルダを接続するにはWinFspのインストールが必要です。',
            'Connecting folders requires WinFsp to be installed.',
          );
        }
      } else if (process.platform === 'darwin') {
        detail = t(
          'macOSのNFSマウントを使用します。このビルドの実機動作は未検証です。',
          'Uses the macOS NFS mount. This build has not been tested on real hardware.',
        );
        mountAvailable = types.mountTypes.includes('nfsmount');
      } else {
        mountAvailable = false;
        detail = t('このOSでのマウントは未対応です。', 'Mounting is not supported on this OS.');
      }
      return {
        available: true,
        version: String(version.version),
        oauthConfigured: this.accounts.configured,
        mountAvailable,
        detail,
        prerequisite,
      };
    } catch (error) {
      return {
        available: false,
        oauthConfigured: this.accounts.configured,
        mountAvailable: false,
        detail: (error as Error).message,
      };
    }
  }
  private async declarationFile(scopeId: string) {
    const space = await this.files.get(scopeId);
    const dir = await this.files.resolve(scopeId, '.irori');
    if (dir !== path.join(space.root, '.irori'))
      throw Error('Cloud metadata directory must not be an alias');
    const filename = path.join(dir, 'cloud-mounts.json');
    try {
      if ((await fs.lstat(filename)).isSymbolicLink())
        throw Error('Cloud metadata must not be a symlink');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return filename;
  }
  async declarations(scopeId: string): Promise<CloudAttachment[]> {
    const records = z
      .array(cloudDeclaration)
      .max(100)
      .parse(await readLocalJson(await this.declarationFile(scopeId), []));
    const space = await this.files.get(scopeId);
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
  private bindingFile(scopeId: string, mountId: string) {
    return path.join(this.files.dataDir, 'cloud-bindings', `${scopeId}-${mountId}.json`);
  }
  private async binding(scopeId: string, mountId: string): Promise<Binding | undefined> {
    const value = await readLocalJson(this.bindingFile(scopeId, mountId), null);
    if (!value) return;
    const binding = bindingSchema.parse(value);
    if (
      binding.scopeId !== scopeId ||
      binding.mountId !== mountId ||
      binding.root !== (await this.files.get(scopeId)).root
    )
      return;
    return binding;
  }
  writeTarget(scopeId: string, mountId: string): Promise<WriteTarget> {
    return this.mutate(async () => {
      const record = (await this.declarations(scopeId)).find((item) => item.mountId === mountId);
      if (!record)
        throw Error(
          t('送信先の接続が見つかりません。', 'The destination connection was not found.'),
        );
      const binding = await this.binding(scopeId, mountId);
      const account = (await this.accounts.list()).find((item) => item.id === binding?.accountId);
      if (!binding || account?.state !== 'ready')
        throw Error(
          t(
            '送信準備にはログイン済みアカウントを紐づけてください。',
            'Link a signed-in account before preparing an upload.',
          ),
        );
      return {
        ownerId: scopeId,
        mountId,
        folderId: record.folderId,
        accountId: binding.accountId,
        driveId: record.driveId,
      };
    });
  }
  async connections(scopeId: string): Promise<CloudConnection[]> {
    const records = await this.declarations(scopeId);
    const accounts = await this.accounts.list();
    return Promise.all(
      records.map(async (record) => {
        const binding = await this.binding(scopeId, record.mountId);
        const key = this.key(scopeId, record.mountId);
        const mounted = this.mounted.get(key);
        if (mounted) {
          try {
            await this.assertMounted(mounted);
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
        const account = accounts.find((item) => item.id === binding?.accountId);
        const current = this.mounted.get(key);
        return {
          ...record,
          accountName: account?.name,
          accountWritable: account?.state === 'ready' && account.writable === true,
          ...(this.states.get(key) ?? {
            state: binding ? ('disconnected' as const) : ('unconfigured' as const),
          }),
          ...(current ? await this.uploads(current) : {}),
        };
      }),
    );
  }
  private async parent(record: Pick<CloudAttachment, 'scopeId' | 'contentsRoot'>, create = false) {
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
  private async checkVacant(record: CloudAttachment, binding?: Binding) {
    const parent = await this.parent(record);
    if (!parent) return;
    const siblings = await fs.readdir(parent);
    const collision = siblings.find((name) => nameKey(name) === nameKey(record.name));
    if (!collision) return;
    const target = path.join(parent, collision);
    const info = await fs.lstat(target);
    if (
      collision === record.name &&
      !info.isSymbolicLink() &&
      info.isDirectory() &&
      binding?.placeholder?.dev === info.dev &&
      binding.placeholder.ino === info.ino
    ) {
      await fs.chmod(target, 0o700);
      try {
        if ((await fs.readdir(target)).length === 0) return;
      } finally {
        await fs.chmod(target, 0o000);
      }
    }
    throw Error(
      t(
        '同じ名前のフォルダ・ファイルまたは接続先があります。別の名前を指定してください。',
        'A folder, file or connection with the same name exists. Choose another name.',
      ),
    );
  }
  add(input: AddCloudAttachment) {
    return this.mutate(async () => {
      const error = mountNameError(input.name);
      if (error) throw Error(error);
      const records = await this.declarations(input.scopeId);
      if (records.length >= 100)
        throw Error(
          t(
            '接続先は1スペースにつき100件まで登録できます。',
            'Each space can register up to 100 connections.',
          ),
        );
      const record = cloudDeclaration.parse({
        schemaVersion: 1,
        mountId: randomUUID(),
        scopeId: input.scopeId,
        provider: 'google-drive',
        folderId: input.folder.id,
        parentId: input.folder.parentId,
        driveId: input.folder.driveId,
        folderName: input.folder.name,
        contentsRoot: input.contentsRoot,
        name: input.name,
        // Materials are worked on in the IDE, so a new connection may change its folder.
        access: input.access ?? 'read-write',
      });
      if (!(await this.files.get(input.scopeId)).contents.includes(record.contentsRoot))
        throw Error(
          t('contentsの登録先を選択してください。', 'Choose where in contents to register it.'),
        );
      if (
        records.some(
          (item) =>
            nameKey(item.contentsRoot + '/' + item.name) ===
            nameKey(record.contentsRoot + '/' + record.name),
        )
      )
        throw Error(t('同じ名前の接続先があります。', 'A connection with the same name exists.'));
      await this.checkVacant(record);
      await this.accounts.verify(input.accountId, input.folder);
      await this.checkVacant(record);
      if (JSON.stringify(await this.declarations(input.scopeId)) !== JSON.stringify(records))
        throw Error(
          t(
            '接続情報が外部で変更されました。再読み込みしてから登録してください。',
            'The connection information changed outside irori. Reload before registering.',
          ),
        );
      await writeLocalJson(await this.declarationFile(input.scopeId), [...records, record]);
      await writeLocalJson(this.bindingFile(record.scopeId, record.mountId), {
        scopeId: record.scopeId,
        mountId: record.mountId,
        root: (await this.files.get(record.scopeId)).root,
        accountId: input.accountId,
      });
      return (await this.connections(record.scopeId)).find(
        (item) => item.mountId === record.mountId,
      )!;
    });
  }
  bind(scopeId: string, mountId: string, accountId: string) {
    return this.mutate(async () => {
      if (this.mounted.has(this.key(scopeId, mountId)))
        throw Error(
          t(
            '接続を解除してからアカウントを変更してください。',
            'Disconnect before changing the account.',
          ),
        );
      const record = (await this.declarations(scopeId)).find((item) => item.mountId === mountId);
      if (!record) throw Error('Unknown cloud connection');
      await this.accounts.verify(accountId, {
        id: record.folderId,
        name: record.folderName,
        parentId: record.parentId,
        driveId: record.driveId,
      });
      const old = await this.binding(scopeId, mountId);
      await writeLocalJson(this.bindingFile(scopeId, mountId), {
        ...old,
        scopeId,
        mountId,
        root: (await this.files.get(scopeId)).root,
        accountId,
      });
      this.states.delete(this.key(scopeId, mountId));
    });
  }
  // Only remove an empty placeholder whose persisted identity is still ours.
  // Remote mounts, replacement directories and user-created bytes are never deleted.
  private async releasePlaceholder(record: CloudAttachment, binding?: Binding) {
    const parent = await this.parent(record);
    if (!parent) return;
    const target = path.join(parent, record.name);
    const info = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!info || info.isSymbolicLink()) return;
    if (info.dev !== (await fs.stat(parent)).dev)
      throw Error(
        t(
          'マウントが残っています。接続を解除してから変更してください。',
          'A mount is still active. Disconnect before changing it.',
        ),
      );
    if (
      !info.isDirectory() ||
      info.dev !== binding?.placeholder?.dev ||
      info.ino !== binding.placeholder.ino
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
      const records = await this.declarations(scopeId);
      const record = records.find((item) => item.mountId === mountId);
      if (!record) throw Error('Unknown cloud connection');
      let replacement: CloudAttachment | undefined;
      if (name !== undefined) {
        const error = mountNameError(name);
        if (error) throw Error(error);
        if (name === record.name) return;
        replacement = { ...record, name };
        if (
          records.some(
            (item) =>
              item.mountId !== mountId &&
              nameKey(`${item.contentsRoot}/${item.name}`) ===
                nameKey(`${record.contentsRoot}/${name}`),
          )
        )
          throw Error(t('同じ名前の接続先があります。', 'A connection with the same name exists.'));
        await this.checkVacant(replacement);
      }
      const binding = await this.binding(scopeId, mountId);
      await this.releasePlaceholder(record, binding);
      if (binding) {
        delete binding.placeholder;
        await writeLocalJson(this.bindingFile(scopeId, mountId), binding);
      }
      if (JSON.stringify(await this.declarations(scopeId)) !== JSON.stringify(records))
        throw Error(
          t(
            '接続情報が外部で変更されました。再読み込みしてください。',
            'The connection information changed outside irori. Reload it.',
          ),
        );
      await writeLocalJson(
        await this.declarationFile(scopeId),
        records.flatMap((item) =>
          item.mountId !== mountId ? [item] : replacement ? [replacement] : [],
        ),
      );
      if (!replacement) await fs.rm(this.bindingFile(scopeId, mountId), { force: true });
      this.states.delete(key);
    });
  }
  connect(scopeId: string, mountId: string) {
    return this.mutate(() => this.mount(scopeId, mountId));
  }
  private async mount(scopeId: string, mountId: string) {
    const key = this.key(scopeId, mountId);
    const record = (await this.declarations(scopeId)).find((item) => item.mountId === mountId);
    if (!record) throw Error('Unknown cloud connection');
    if (this.mounted.has(key)) {
      try {
        await this.assertMounted(this.mounted.get(key)!);
        this.states.set(key, { state: 'mounted' });
        return;
      } catch {
        this.mounted.delete(key);
      }
    }
    const binding = await this.binding(scopeId, mountId);
    if (!binding)
      throw Error(
        t(
          'この端末で使用するアカウントを紐づけてください。',
          'Link the account to use on this device.',
        ),
      );
    this.states.set(key, { state: 'connecting' });
    let target: string | undefined;
    let requested = false;
    try {
      const setup = await this.setup();
      if (!setup.mountAvailable) throw Error(setup.detail);
      await this.accounts.verify(binding.accountId, {
        id: record.folderId,
        name: record.folderName,
        parentId: record.parentId,
        driveId: record.driveId,
      });
      await this.checkVacant(record, binding);
      const parent = (await this.parent(record, true))!;
      target = path.join(parent, record.name);
      await this.checkVacant(record, binding);
      if (process.platform !== 'win32') {
        const existing = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return undefined;
        });
        if (!existing) {
          await fs.mkdir(target, { mode: 0o000 });
          const stat = await fs.lstat(target);
          binding.placeholder = { dev: stat.dev, ino: stat.ino };
          await writeLocalJson(this.bindingFile(scopeId, mountId), binding);
        }
        await fs.chmod(target, 0o700);
      }
      // An editable connection whose account may only read still mounts, read-only,
      // until the account is signed in again with permission to change files.
      const writable =
        record.access === 'read-write' && (await this.accounts.writable(binding.accountId));
      // The description only makes each mount a distinct rclone file system, so two
      // connections to one Drive folder never share a write cache or its statistics.
      const remote = {
        ...(await this.accounts.filesystem(binding.accountId, record.folderId, record.driveId)),
        description: `irori-mount-${record.mountId}`,
      };
      const identity = await this.rpc.call('operations/fsinfo', { fs: remote });
      const filesystem = `${z.string().min(1).parse(identity.Name)}:${z.string().parse(identity.Root)}`;
      requested = true;
      await this.rpc.call('mount/mount', {
        fs: remote,
        mountPoint: target,
        ...(process.platform === 'darwin' ? { mountType: 'nfsmount' } : {}),
        mountOpt: { AllowOther: false },
        // Writing needs rclone's write cache (CacheMode 2, "writes"): files are staged on
        // this device and uploaded shortly after they are closed. macOS's NFS mount is
        // read-only without it. Changes left when irori quits are uploaded on the next mount.
        vfsOpt: writable
          ? { ReadOnly: false, CacheMode: 2, DirPerms: 0o700, FilePerms: 0o600 }
          : { ReadOnly: true, CacheMode: 0, DirPerms: 0o500, FilePerms: 0o400 },
      });
      const stat = await fs.stat(target);
      if (stat.dev === (await fs.stat(parent)).dev)
        throw Error(
          t(
            'マウントされたファイルシステムを確認できません。',
            'Could not verify the mounted file system.',
          ),
        );
      const mounted = {
        attachment: record,
        target,
        device: stat.dev,
        inode: stat.ino,
        filesystem,
        remote,
        writable,
      };
      await this.assertMounted(mounted);
      this.mounted.set(key, mounted);
      this.states.set(key, { state: 'mounted' });
    } catch (error) {
      if (requested && target)
        await this.rpc.call('mount/unmount', { mountPoint: target }).catch(() => {});
      if (target && binding.placeholder) {
        const info = await fs.lstat(target).catch(() => undefined);
        if (info?.dev === binding.placeholder.dev && info.ino === binding.placeholder.ino)
          await fs.chmod(target, 0o000).catch(() => {});
      }
      this.states.set(key, { state: 'error', detail: (error as Error).message });
      throw error;
    }
  }
  private async assertMounted(mounted: Mounted) {
    const records = await this.rpc.call('mount/listmounts');
    if (
      !Array.isArray(records.mountPoints) ||
      !records.mountPoints.some(
        (item: any) => item.MountPoint === mounted.target && item.Fs === mounted.filesystem,
      )
    )
      throw Error(t('マウントが利用できません。', 'The mount is not available.'));
    const stat = await fs.lstat(mounted.target);
    if (stat.isSymbolicLink() || stat.dev !== mounted.device || stat.ino !== mounted.inode)
      throw Error(
        t('マウント先の識別情報が変わりました。', 'The identity of the mount point has changed.'),
      );
  }
  /**
   * `leavePending` takes the folder away although saved changes still wait: they
   * stay in rclone's cache and are uploaded when the folder is next mounted
   * editable. An upload that keeps failing, for example for want of permission,
   * would otherwise leave no way to disconnect, sign in again or make it read-only.
   */
  disconnect(scopeId: string, mountId: string, leavePending = false) {
    return this.mutate(async () => {
      if (!leavePending) await this.assertSent(scopeId, mountId);
      await this.unmount(scopeId, mountId);
    });
  }
  /** Refuses to take a mount away while saved changes still wait to be uploaded. */
  private async assertSent(scopeId: string, mountId: string) {
    const mounted = this.mounted.get(this.key(scopeId, mountId));
    const pending = mounted && (await this.pending(mounted));
    if (pending)
      throw Error(
        t(
          `Google Drive への送信待ちが ${pending} 件あります。送信が終わってから操作してください。`,
          `${pending} saved changes are still waiting to be uploaded to Google Drive. Try again once they are sent.`,
        ),
      );
  }
  /** Saved changes of a writable mount still waiting to reach Google Drive, if rclone can tell. */
  private async pending(mounted: Mounted): Promise<number | undefined> {
    if (!mounted.writable) return 0;
    try {
      const stats = await this.rpc.call('vfs/stats', { fs: mounted.filesystem });
      const count =
        Number(stats?.diskCache?.uploadsInProgress ?? 0) +
        Number(stats?.diskCache?.uploadsQueued ?? 0);
      return Number.isFinite(count) ? count : undefined;
    } catch {
      return undefined;
    }
  }
  /** What a mount reports about its uploads: how many wait, and why they fail when they do. */
  private async uploads(
    mounted: Mounted,
  ): Promise<Pick<CloudConnection, 'writable' | 'pending' | 'uploadError'>> {
    const pending = await this.pending(mounted);
    const failing = pending ? await this.failingUploads(mounted) : [];
    if (!failing.length) return { writable: mounted.writable, pending };
    // One line names the category the most failing changes share.
    const counts = new Map<UploadErrorCategory, number>();
    for (const category of failing) counts.set(category, (counts.get(category) ?? 0) + 1);
    const [category] = [...counts].sort((a, b) => b[1] - a[1])[0];
    return {
      writable: mounted.writable,
      pending,
      uploadError: uploadErrorMessage(category, failing.length),
    };
  }
  /**
   * The category of each queued upload rclone has tried and failed. The queue says
   * how often an item was tried, and an item still queued after a try failed it; why
   * is only in rclone's log, matched by the item's name. Nothing here throws: a
   * queue that cannot be read leaves the connection with its waiting count alone.
   */
  private async failingUploads(mounted: Mounted): Promise<UploadErrorCategory[]> {
    try {
      const queue = queueSchema.safeParse(
        await this.rpc.call('vfs/queue', { fs: mounted.filesystem }),
      );
      if (!queue.success) return [];
      const failures = this.rpc.uploadFailures?.() ?? [];
      return queue.data.queue
        .filter((item) => (item.tries ?? 0) >= (item.uploading ? 2 : 1))
        .map((item) => {
          for (let i = failures.length - 1; i >= 0; i--)
            if (failures[i].path === item.name) return failures[i].category;
          return 'other';
        });
    } catch {
      return [];
    }
  }
  /** Saved changes still waiting to be uploaded, across every mount. */
  async pendingUploads() {
    let total = 0;
    for (const mounted of this.mounted.values()) total += (await this.pending(mounted)) ?? 0;
    return total;
  }
  /**
   * Whether a connection may change its Drive folder. The mount options are fixed
   * when a folder is mounted, so a connected folder is mounted again.
   */
  setAccess(scopeId: string, mountId: string, access: CloudAccess, leavePending = false) {
    return this.mutate(async () => {
      const records = await this.declarations(scopeId);
      const record = records.find((item) => item.mountId === mountId);
      if (!record) throw Error('Unknown cloud connection');
      if (record.access === access) return;
      const key = this.key(scopeId, mountId);
      const wasMounted = this.mounted.has(key);
      if (wasMounted) {
        if (!leavePending) await this.assertSent(scopeId, mountId);
        await this.unmount(scopeId, mountId);
      }
      if (JSON.stringify(await this.declarations(scopeId)) !== JSON.stringify(records))
        throw Error(
          t(
            '接続情報が外部で変更されました。再読み込みしてください。',
            'The connection information changed outside irori. Reload it.',
          ),
        );
      await writeLocalJson(
        await this.declarationFile(scopeId),
        records.map((item) => (item.mountId === mountId ? { ...item, access } : item)),
      );
      if (wasMounted) await this.mount(scopeId, mountId);
    });
  }
  /**
   * Signs an account in again with permission to change files. Its remote is
   * replaced while signing in, so no folder may be mounted through it meanwhile.
   */
  reauthorizeAccount(id: string) {
    return this.mutate(async () => {
      for (const mounted of this.mounted.values()) {
        const binding = await this.binding(mounted.attachment.scopeId, mounted.attachment.mountId);
        if (binding?.accountId === id)
          throw Error(
            t(
              'このアカウントを使う接続を解除してから再ログインしてください。',
              'Disconnect the folders that use this account before signing in again.',
            ),
          );
      }
      await this.accounts.reauthorize(id);
    });
  }
  /** The folder a connection is mounted on, for the system file manager. */
  async folder(scopeId: string, mountId: string) {
    const mounted = this.mounted.get(this.key(scopeId, mountId));
    if (!mounted)
      throw Error(
        t(
          'クラウドフォルダは未接続です。接続画面から再接続してください。',
          'The cloud folder is not connected. Reconnect it from the Connect screen.',
        ),
      );
    await this.assertMounted(mounted);
    return mounted.target;
  }
  /** Whether a path lies inside a folder mounted so that it can be changed. */
  writable(scopeId: string, rel: string) {
    const root = this.roots.get(scopeId);
    if (!root) return false;
    const target = path.join(root, rel);
    return [...this.mounted.values()].some(
      (item) => item.attachment.scopeId === scopeId && item.writable && within(item.target, target),
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
  /**
   * Writes an edited text file in place. Replacing it through a temporary file would
   * make Drive delete the original and upload a new one, losing its version history
   * and sharing; writing the same file makes the upload a new version of it.
   */
  write(doc: Document) {
    return this.mutate(async () => {
      if (Buffer.byteLength(doc.text, 'utf8') > textFileByteLimit)
        throw Error('The text editor supports files up to 2 MiB');
      if (doc.text.includes('\0')) throw Error('Binary files cannot be edited as text');
      const { mounted, filename } = await this.locate(doc.scopeId, doc.path);
      await this.assertWritable(doc.scopeId, doc.path);
      const conflict = () =>
        Error(
          t(
            'CONFLICT: ディスク上の変更を確認してください。下書きは保持されています。',
            'CONFLICT: Check the changes on disk. Your draft is kept.',
          ),
        );
      const before = await fs.readFile(filename);
      if (hash(before) !== doc.hash) throw conflict();
      if (hash(doc.text) === doc.hash) return;
      if (await this.changedInDrive(mounted, filename, before)) throw conflict();
      // The previous version stays on this device as well as in Drive's history.
      await writeLocalFile(
        path.join(this.files.dataDir, `backup-${hash(before)}.txt`),
        before.toString('utf8'),
      );
      if (hash(await fs.readFile(filename)) !== doc.hash) throw conflict();
      await fs.writeFile(filename, doc.text);
    });
  }
  /**
   * Whether Drive holds a version of the file other than the bytes the editor started
   * from. The mount learns of a change made elsewhere only when rclone polls Drive,
   * about once a minute, so a save inside that window would overwrite it unnoticed.
   * Drive is asked directly, past the mount's cache, for the file's MD5 checksum. A
   * file still in rclone's upload queue is our own earlier save that Drive has not
   * received yet, so it is not compared. When Drive cannot be asked (offline, a
   * timeout, an RC error) or has no checksum for the file (a Google Docs file, or one
   * no longer there), the save is allowed: editing keeps working offline, and rclone
   * uploads the change once it can.
   */
  private async changedInDrive(mounted: Mounted, filename: string, before: Buffer) {
    const remote = path.relative(mounted.target, filename).split(path.sep).join('/');
    try {
      const { queue } = await this.rpc.call('vfs/queue', { fs: mounted.filesystem });
      if (Array.isArray(queue) && queue.some((item) => item?.name === remote)) return false;
      // Autosave runs a second after typing stops, so an unreachable Drive may cost a
      // save a few seconds at most, not rclone's own connection timeout.
      const { item } = await bounded(
        this.rpc.call('operations/stat', {
          fs: mounted.remote,
          remote,
          opt: { filesOnly: true, hashTypes: ['md5'] },
        }),
        5000,
      );
      const checksum = item?.Hashes?.md5;
      if (typeof checksum !== 'string' || !checksum) return false;
      if (checksum.toLowerCase() === createHash('md5').update(before).digest('hex')) return false;
    } catch {
      return false;
    }
    // Drive's version reaches the mount now rather than at the next poll, so the
    // editor's reload shows it. The save is refused either way.
    const dir = remote.includes('/') ? remote.slice(0, remote.lastIndexOf('/')) : '';
    await this.rpc.call('vfs/refresh', { fs: mounted.filesystem, dir }).catch(() => {});
    return true;
  }
  /** A text file in a Drive connection, with whether it may be edited and any kept draft. */
  async document(scopeId: string, rel: string): Promise<Document> {
    const root = await this.files.get(scopeId);
    this.roots.set(scopeId, root.root);
    const doc = await readTextDocument(await this.resolve(scopeId, rel), scopeId, rel);
    const writable = this.writable(scopeId, rel);
    const draft = writable
      ? await readLocalJson(draftFile(this.files.dataDir, scopeId, rel), null)
      : null;
    return {
      ...doc,
      readOnly: !writable,
      cloud: true,
      ...(root.workspace ? { workspaceId: scopeId } : {}),
      ...(draft
        ? { draft: z.object({ text: z.string(), baseHash: z.string() }).parse(draft) }
        : {}),
    };
  }
  /** Keeps the unsaved text of a workspace Drive document on this device. */
  async draft(doc: Document) {
    await this.workspaceRoot(doc.scopeId);
    await this.assertWritable(doc.scopeId, doc.path);
    await writeLocalJson(draftFile(this.files.dataDir, doc.scopeId, doc.path), {
      text: doc.text,
      baseHash: doc.hash,
    });
  }
  /** Saves a workspace Drive document, keeping a draft until the file holds the text. */
  async save(doc: Document) {
    await this.draft(doc);
    await this.write(doc);
    await fs.rm(draftFile(this.files.dataDir, doc.scopeId, doc.path), { force: true });
    return this.document(doc.scopeId, doc.path);
  }
  /** A path inside a verified mount that may be changed, with the mount it lies in. */
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
   * Renames or moves a file or folder inside one editable connection. The mount
   * turns the rename into rclone's Move or DirMove, which Drive performs server-side
   * by updating the entry's name and parents, so it keeps its ID, version history
   * and sharing; a file still in the write cache is renamed there and uploaded
   * under its new name. `to` is the full new path; an existing entry is never
   * replaced, and neither is a name that differs only in case or normalization.
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
      const parent = path.join(await this.rootOf(scopeId), directory);
      if (!within(mounted.target, parent))
        throw Error(
          t(
            '同じ接続フォルダの中にだけ移動できます。',
            'An entry can only be moved within its own connected folder.',
          ),
        );
      try {
        await this.resolve(scopeId, directory);
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
            '同じ名前のファイルまたはフォルダがあります。別の名前を指定してください。',
            'A file or folder with the same name exists. Choose another name.',
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
  /**
   * Removes a file or folder of an editable connection through the mount. rclone's
   * Drive backend sends what is deleted to Drive's trash (`use_trash`, on unless
   * turned off; irori's remote sets only the account, the root folder and the
   * drive), so the entry can be restored there. A folder is removed entry by entry,
   * as the file system requires, so each of its files reaches the trash on its own.
   */
  deleteEntry(scopeId: string, target: string): Promise<void> {
    return this.mutate(async () => {
      const { actual } = await this.editable(scopeId, target);
      if ((await fs.lstat(actual)).isDirectory()) await fs.rm(actual, { recursive: true });
      else {
        await fs.unlink(actual);
        // The draft would only offer text for a file that is gone. Drafts of files
        // inside a removed folder cannot be found by path and stay unread.
        await fs.rm(draftFile(this.files.dataDir, scopeId, target), { force: true });
      }
    });
  }
  /** Adds an empty Markdown note to an editable Drive folder; an existing file is never replaced. */
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
      let unmountFailed = false;
      try {
        await this.rpc.call('mount/unmount', { mountPoint: mounted.target });
      } catch (error) {
        const result = await this.rpc.call('mount/listmounts').catch(() => {
          throw error;
        });
        const listed = z
          .array(z.object({ MountPoint: z.string().min(1), Fs: z.string().min(1) }))
          .safeParse(result?.mountPoints);
        if (!listed.success || listed.data.some((item) => item.MountPoint === mounted.target))
          throw error;
        // A crashed mount process can disappear before unmount is requested. Only
        // accept that result when the filesystem below independently confirms it.
        unmountFailed = true;
      }
      const remaining = await fs.lstat(mounted.target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      });
      if (
        remaining &&
        ((remaining.isSymbolicLink() && unmountFailed) ||
          (!remaining.isSymbolicLink() &&
            remaining.dev !== (await fs.stat(path.dirname(mounted.target))).dev))
      )
        throw Error(
          t(
            'マウントの解除を確認できません。もう一度接続を解除してください。',
            'Could not confirm the unmount. Disconnect again.',
          ),
        );
      const binding = await this.binding(scopeId, mountId);
      if (binding?.placeholder) {
        if (remaining?.dev === binding.placeholder.dev && remaining.ino === binding.placeholder.ino)
          await fs.chmod(mounted.target, 0o000);
      }
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
      (item) => item.attachment.scopeId === scopeId && within(item.target, target),
    );
    if (!entry)
      throw Error(
        t(
          'クラウドフォルダは未接続です。接続画面から再接続してください。',
          'The cloud folder is not connected. Reconnect it from the Connect screen.',
        ),
      );
    await this.assertMounted(entry);
    // The mount point's identity is verified above; below it no component may be
    // a link, checked one component at a time as parent() does above it. realpath
    // cannot be used: on Windows a WinFsp volume mounted on a folder has no DOS
    // name, so GetFinalPathNameByHandleW fails and Node reports UNKNOWN for every
    // path inside the mount.
    let actual = entry.target;
    for (const part of path.relative(entry.target, target).split(path.sep).filter(Boolean)) {
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
            blocked: t(
              '登録されていないローカルデータです。既存の内容を保持しています。',
              'Unregistered local data. Its existing contents are kept.',
            ),
          });
      }
    return entries;
  }
  async entries(id: string, rel: string): Promise<Entry[]> {
    await this.workspaceRoot(id);
    const roots = await this.rootEntries(id, rel);
    if (roots) return roots;
    const entries = await fs.readdir(await this.resolve(id, rel), { withFileTypes: true });
    if (entries.length > 4000) throw Error('This directory exceeds the 4,000-entry limit');
    const writable = this.writable(id, rel);
    return entries
      .map((entry): Entry => ({
        path: `${rel}/${entry.name}`,
        name: entry.name,
        directory: entry.isDirectory(),
        note: /\.md$/i.test(entry.name),
        layer: 'contents',
        blocked: entry.isSymbolicLink()
          ? t('リンク先は開けません', 'Link targets cannot be opened')
          : undefined,
        ...(writable && !entry.isSymbolicLink() ? { writable: true } : {}),
      }))
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  }
  async read(id: string, rel: string) {
    await this.workspaceRoot(id);
    return this.document(id, rel);
  }
  async close() {
    this.stopping = true;
    try {
      await this.queue.idle();
      await this.accounts.close();
      for (const mounted of this.mounted.values())
        await this.unmount(mounted.attachment.scopeId, mounted.attachment.mountId);
      await this.rpc.close();
    } catch (error) {
      this.stopping = false;
      throw error;
    }
  }
}
