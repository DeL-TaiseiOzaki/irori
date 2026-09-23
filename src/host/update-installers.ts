import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { UpdateInstaller } from './updates';

export interface Commands {
  run(
    file: string,
    args: string[],
    timeoutMs?: number,
  ): Promise<{ stdout: string; stderr: string }>;
  /** Starts a process that outlives this one; resolves once it has started. */
  detach(file: string, args: string[]): Promise<void>;
}

export const systemCommands: Commands = {
  run: (file, args, timeoutMs = 10 * 60_000) =>
    new Promise((resolve, reject) => {
      execFile(
        file,
        args,
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => (error ? reject(error) : resolve({ stdout, stderr })),
      );
    }),
  detach: (file, args) =>
    new Promise((resolve, reject) => {
      const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    }),
};

async function step<T>(message: string, work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch {
    throw Error(message);
  }
}

/**
 * Windows. Squirrel installed irori as <root>\app-<version>\irori.exe beside <root>\Update.exe,
 * the layout Electron's own autoUpdater drives. Update.exe applies a full package beside the
 * running version, and starts the newest installed version once this process has exited.
 */
export class SquirrelInstaller implements UpdateInstaller {
  private readonly root: string;
  private readonly updateExe: string;
  private readonly exeName: string;
  constructor(
    execPath: string,
    private readonly commands: Commands = systemCommands,
  ) {
    this.root = path.resolve(path.dirname(execPath), '..');
    this.updateExe = path.join(this.root, 'Update.exe');
    this.exeName = path.basename(execPath);
  }

  async unavailable() {
    try {
      await access(this.updateExe);
      return undefined;
    } catch {
      return 'インストーラーで導入した irori だけが、アプリ内で更新できます。インストーラーを取得してください。';
    }
  }

  async cleanup() {}

  async prepare({ file, version, size, sha1 }: Parameters<UpdateInstaller['prepare']>[0]) {
    const feed = path.dirname(file);
    // The feed Update.exe reads: RELEASES names the package with the SHA-1 and size that
    // Squirrel checks again before applying it.
    await writeFile(
      path.join(feed, 'RELEASES'),
      `${sha1.toUpperCase()} ${path.basename(file)} ${size}`,
    );
    await step(
      'Windows の更新処理を完了できませんでした。インストーラーを取得して更新してください。',
      this.commands.run(this.updateExe, ['--update', feed], 15 * 60_000),
    );
    // Update.exe also succeeds when it finds nothing newer to apply.
    await step(
      `更新後の irori ${version} が見つかりません。インストーラーを取得して更新してください。`,
      access(path.join(this.root, `app-${version}`, this.exeName)),
    );
  }

  async restart() {
    // As autoUpdater.quitAndInstall does: Update.exe waits for this process to exit, then
    // starts the newest installed version.
    await step(
      '新しい版を起動する準備ができませんでした。',
      this.commands.detach(this.updateExe, ['--processStartAndWait', this.exeName]),
    );
  }
}

// Waits for irori to exit, opens the replacement through Launch Services, then removes the
// folder holding the previous bundle. Arguments: pid, bundle, work folder, open command.
export const relaunchScript =
  'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; "$4" "$2"; rm -rf "$3"';

/**
 * macOS. Squirrel.Mac accepts an update only when its signature satisfies the running app's
 * designated requirement, and an ad-hoc signature pins that requirement to this exact build,
 * so the bundle is replaced directly. The published disk image, the bytes CI verified, is
 * copied into a hidden folder beside the installed bundle so that the final rename never
 * crosses a volume, and it is checked before anything installed is touched.
 */
export class BundleInstaller implements UpdateInstaller {
  readonly bundle: string;
  private readonly work: string;
  private readonly staged: string;
  constructor(
    private readonly execPath: string,
    private readonly options: { pid?: number; commands?: Commands; open?: string } = {},
  ) {
    this.bundle = path.resolve(execPath, '..', '..', '..');
    this.work = path.join(path.dirname(this.bundle), '.irori-update');
    this.staged = path.join(this.work, 'irori.app');
  }

  private get commands() {
    return this.options.commands ?? systemCommands;
  }

  async unavailable() {
    if (
      path.extname(this.bundle) !== '.app' ||
      path.relative(this.bundle, this.execPath) !== path.join('Contents', 'MacOS', 'irori')
    )
      return 'アプリのバンドルを特定できないため、アプリ内で更新できません。インストーラーを取得してください。';
    // macOS runs a quarantined app that was never moved from a read-only, randomized path.
    if (this.bundle.includes('/AppTranslocation/'))
      return 'irori を「アプリケーション」フォルダに移してから開くと、アプリ内で更新できます。';
    try {
      await access(path.dirname(this.bundle), constants.W_OK);
      await access(this.bundle, constants.W_OK);
      return undefined;
    } catch {
      return 'irori を置いているフォルダに書き込めないため、アプリ内で更新できません。インストーラーを取得してください。';
    }
  }

  async cleanup() {
    await rm(this.work, { recursive: true, force: true });
  }

  async prepare({ file, version }: Parameters<UpdateInstaller['prepare']>[0]) {
    const { run } = this.commands;
    await this.cleanup();
    await mkdir(this.work);
    const mount = await mkdtemp(path.join(tmpdir(), 'irori-update-'));
    try {
      await step(
        '更新のディスクイメージを開けませんでした。',
        run('hdiutil', [
          'attach',
          file,
          '-nobrowse',
          '-noautoopen',
          '-readonly',
          '-mountpoint',
          mount,
        ]),
      );
      try {
        // ditto keeps the symlinks, permissions and extended attributes the seal covers.
        await step(
          '更新のディスクイメージから irori を取り出せませんでした。',
          run('ditto', [path.join(mount, 'irori.app'), this.staged]),
        );
      } finally {
        await run('hdiutil', ['detach', mount, '-force']).catch(() => {});
      }
    } finally {
      // Not recursive: if the image is still attached, its contents are not ours to remove.
      await rmdir(mount).catch(() => {});
    }
    await step(
      '新しい版の署名を確認できませんでした。',
      run('codesign', ['--verify', '--deep', '--strict', this.staged]),
    );
    const { stderr } = await step(
      '新しい版の署名を確認できませんでした。',
      run('codesign', ['--display', '--verbose=2', this.staged]),
    );
    if (!/^Identifier=io\.github\.deltaiseiozaki\.irori$/m.test(stderr))
      throw Error('更新のディスクイメージにあるアプリが irori ではありません。');
    const { stdout } = await step(
      '新しい版のバージョンを確認できませんでした。',
      run('plutil', [
        '-extract',
        'CFBundleShortVersionString',
        'raw',
        '-o',
        '-',
        path.join(this.staged, 'Contents', 'Info.plist'),
      ]),
    );
    if (stdout.trim() !== version)
      throw Error(`ディスクイメージの irori ${stdout.trim()} が公開版 ${version} と一致しません。`);
  }

  async restart() {
    const previous = path.join(this.work, 'previous.app');
    try {
      await rename(this.bundle, previous);
    } catch (error) {
      throw Error(refused(error));
    }
    try {
      await rename(this.staged, this.bundle);
    } catch (error) {
      await rename(previous, this.bundle).catch(() => {});
      throw Error(refused(error));
    }
    try {
      await this.commands.detach('/bin/sh', [
        '-c',
        relaunchScript,
        'irori-update',
        String(this.options.pid ?? process.pid),
        this.bundle,
        this.work,
        this.options.open ?? '/usr/bin/open',
      ]);
    } catch {
      // Nothing would start the new version, so the running one goes back in place.
      await rename(this.bundle, this.staged).catch(() => {});
      await rename(previous, this.bundle).catch(() => {});
      throw Error('新しい版を起動する準備ができませんでした。');
    }
  }
}

function refused(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  // App Management refuses an app that modifies another app's bundle with EPERM.
  if (code === 'EPERM')
    return 'macOS が irori の置き換えを許可しませんでした。「システム設定」→「プライバシーとセキュリティ」→「アプリ管理」で irori を許可してから再試行するか、インストーラーを取得してください。';
  return `irori を置き換えられませんでした（${code ?? 'unknown'}）。インストーラーを取得してください。`;
}

/** The installer for the platform a packaged irori runs on, if it can replace itself there. */
export function platformInstaller(platform: string, execPath: string): UpdateInstaller | undefined {
  if (platform === 'win32') return new SquirrelInstaller(execPath);
  if (platform === 'darwin') return new BundleInstaller(execPath);
  return undefined;
}
