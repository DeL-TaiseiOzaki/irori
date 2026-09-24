import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SerialQueue } from '../host/serial-queue';
import { CloudAccounts } from './accounts';
import type { GoogleOAuth } from './oauth';
import { Rclone, type RcloneAPI } from './rclone';
import { cloudDeclaration, mountNameError, nameKey } from '../domain/connections';
import { owner, within } from '../domain/scopes';
import { readLocalJson, writeLocalJson } from '../host/local-json';
import { readTextDocument } from '../host/files';
import type { CloudStorage } from './storage';
import type { WriteTarget } from './outbox';
import type {
  AddCloudAttachment,
  CloudAttachment,
  CloudConnection,
  CloudSetup,
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
type Mounted = {
  attachment: CloudAttachment;
  target: string;
  device: number;
  inode: number;
  filesystem: string;
};
export class CloudService {
  readonly accounts: CloudAccounts;
  private queue = new SerialQueue();
  private mounted = new Map<string, Mounted>();
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
        return {
          ...record,
          accountName: accounts.find((account) => account.id === binding?.accountId)?.name,
          ...(this.states.get(key) ?? {
            state: binding ? ('disconnected' as const) : ('unconfigured' as const),
          }),
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
        access: 'read-only',
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
    return this.mutate(async () => {
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
        const remote = await this.accounts.filesystem(
          binding.accountId,
          record.folderId,
          record.driveId,
        );
        const identity = await this.rpc.call('operations/fsinfo', { fs: remote });
        const filesystem = `${z.string().min(1).parse(identity.Name)}:${z.string().parse(identity.Root)}`;
        requested = true;
        await this.rpc.call('mount/mount', {
          fs: remote,
          mountPoint: target,
          ...(process.platform === 'darwin' ? { mountType: 'nfsmount' } : {}),
          mountOpt: { AllowOther: false },
          vfsOpt: { ReadOnly: true, CacheMode: 0, DirPerms: 0o500, FilePerms: 0o400 },
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
    });
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
  disconnect(scopeId: string, mountId: string) {
    return this.mutate(() => this.unmount(scopeId, mountId));
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
    if (
      !rel ||
      rel.includes('\\') ||
      rel.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw Error('Invalid cloud path');
    const target = path.join((await this.files.get(scopeId)).root, rel);
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
    return actual;
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
      }))
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  }
  async read(id: string, rel: string) {
    await this.workspaceRoot(id);
    return {
      ...(await readTextDocument(await this.resolve(id, rel), id, rel)),
      readOnly: true,
      workspaceId: id,
    };
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
