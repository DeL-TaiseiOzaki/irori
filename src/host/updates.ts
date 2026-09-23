import { createHash } from 'node:crypto';
import { mkdir, open as openFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  PublishedUpdate,
  UpdateCheck,
  UpdateInstall,
  UpdateState,
  UpdateTarget,
} from '../domain/updates';

const repository = 'https://github.com/DeL-TaiseiOzaki/irori';
export const officialReleasesEndpoint =
  'https://api.github.com/repos/DeL-TaiseiOzaki/irori/releases?per_page=100';
const maxResponseBytes = 2 * 1024 * 1024;
const maxChecksumBytes = 64 * 1024;
// The published packages are about 200 MB; a larger one is not what irori publishes.
const maxPackageBytes = 1024 * 1024 * 1024;
const checksumsName = 'SHA256SUMS.txt';
// Per distributed target, the installer a person downloads and the file the running
// application applies itself: Squirrel's full package on Windows, the same disk image on
// the Mac. Every URL stays built from the fixed official repository, a validated version
// and a known asset name, and a target without a published installer is reported rather
// than guessed.
const targets: Record<
  string,
  { installer(version: string): string; package(version: string): string }
> = {
  'win32-x64': {
    installer: (version) => `irori-${version}-windows-x64-Setup.exe`,
    package: (version) => `irori-${version}-full.nupkg`,
  },
  'darwin-arm64': {
    installer: (version) => `irori-${version}-macos-arm64.dmg`,
    package: (version) => `irori-${version}-macos-arm64.dmg`,
  },
};
const distributedTargets = 'Windows x64 と Apple シリコンの Mac';
const versionPattern =
  /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.(0|[1-9]\d*))?$/;
const assetsSchema = z
  .array(
    z.object({
      name: z.string().max(200),
      browser_download_url: z.string().max(1000),
      state: z.string().max(30),
      size: z.number().int().positive(),
    }),
  )
  .max(100);
const releasesSchema = z
  .array(
    z.object({
      id: z.number().int().positive().optional(),
      tag_name: z.string().max(100),
      html_url: z.string().max(500),
      draft: z.boolean(),
      prerelease: z.boolean(),
      assets: assetsSchema,
    }),
  )
  .max(100);
// GitHub's release list has served a newly published release with an empty file list for
// longer than half an hour, while the release's own assets endpoint listed every file.
const releaseAssetsEndpoint = (id: number) =>
  `https://api.github.com/repos/DeL-TaiseiOzaki/irori/releases/${id}/assets?per_page=100`;
const maxAssetLookups = 3;

function version(value: string) {
  const match = versionPattern.exec(value);
  if (!match) return undefined;
  const core = match.slice(1, 4).map(Number);
  const preview = match[4] === undefined ? undefined : Number(match[4]);
  if (![...core, preview ?? 0].every(Number.isSafeInteger)) return undefined;
  return { core, preview, text: core.join('.') };
}

function compare(
  a: NonNullable<ReturnType<typeof version>>,
  b: NonNullable<ReturnType<typeof version>>,
) {
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  if (a.preview === b.preview) return 0;
  if (a.preview === undefined) return 1;
  if (b.preview === undefined) return -1;
  return a.preview > b.preview ? 1 : -1;
}

class UpdateError extends Error {
  constructor(
    readonly reason: NonNullable<UpdateCheck['reason']>,
    message: string,
  ) {
    super(message);
  }
}
class Cancelled extends Error {}
const invalid = () =>
  new UpdateError(
    'invalid',
    '公開版の情報を確認できませんでした。時間をおいて再試行してください。',
  );
const mismatch = () =>
  new UpdateError(
    'invalid',
    'ダウンロードした更新ファイルが公開版と一致しませんでした。もう一度お試しください。',
  );

// One deadline over a request and its body. A fetch that ignores its signal still loses the
// race, and aborting `outer` abandons the work as well.
async function withDeadline<T>(
  ms: number,
  message: string,
  work: (signal: AbortSignal) => Promise<T>,
  outer?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abandon = () => {};
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new UpdateError('timeout', message));
      controller.abort();
    }, ms);
    abandon = () => {
      reject(new Cancelled());
      controller.abort();
    };
  });
  if (outer?.aborted) abandon();
  else outer?.addEventListener('abort', abandon, { once: true });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    clearTimeout(timeout);
    outer?.removeEventListener('abort', abandon);
    controller.abort();
  }
}

async function readBody(response: Response, signal: AbortSignal, limit: number) {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    void response.body?.cancel().catch(() => {});
    throw invalid();
  }
  if (!response.body) throw invalid();
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw invalid();
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Applies a verified package to the installation this process runs from. */
export interface UpdateInstaller {
  /** Why this installation cannot replace itself, if it cannot. */
  unavailable(): Promise<string | undefined>;
  /** Removes what an earlier, unfinished update left behind. */
  cleanup(): Promise<void>;
  /** Stages the verified package so that `restart` only has to switch to it. */
  prepare(update: { file: string; version: string; size: number; sha1: string }): Promise<void>;
  /** Switches to the staged version and has it start once this process exits. */
  restart(): Promise<void>;
}

interface Asset {
  name: string;
  url: string;
  size: number;
}
interface Published {
  release: PublishedUpdate;
  /** The file this target applies and the release's checksums, when both are published. */
  package?: Asset;
  checksums?: Asset;
}

export class UpdateService {
  private published?: Published;
  private pending?: Promise<UpdateCheck>;
  private latest?: UpdateCheck;
  private progress: UpdateInstall = { phase: 'idle' };
  private installing?: { controller: AbortController; done: Promise<boolean> };
  private switched = false;
  constructor(
    private readonly options: {
      currentVersion: string;
      platform: string;
      arch: string;
      fetch?: typeof fetch;
      timeoutMs?: number;
      /** How long a download may receive nothing before it is abandoned. */
      idleMs?: number;
      /** Applies packages; without one, a new version is offered through the browser only. */
      installer?: UpdateInstaller;
      /** Where a download is kept until the installer has taken it. */
      directory?: string;
      onState?: (state: UpdateState) => void;
    },
  ) {}

  state(): UpdateState {
    return { check: this.latest, install: this.progress };
  }

  check(): Promise<UpdateCheck> {
    if (this.pending) return this.pending;
    this.pending = this.checkPublished()
      .then((result) => {
        this.latest = result;
        this.emit();
        return result;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  /** Checks shortly after startup and then periodically; results arrive through `onState`. */
  watch({ delayMs = 10_000, intervalMs = 60 * 60_000 } = {}): () => void {
    const run = () => {
      // A download or a prepared update keeps the release it was started for.
      if (this.progress.phase === 'idle' || this.progress.phase === 'failed') void this.check();
    };
    const first = setTimeout(run, delayMs);
    const every = setInterval(run, intervalMs);
    first.unref?.();
    every.unref?.();
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }

  async cleanup(): Promise<void> {
    if (this.options.directory) await rm(this.options.directory, { recursive: true, force: true });
    await this.options.installer?.cleanup();
  }

  private emit() {
    this.options.onState?.(this.state());
  }

  private setProgress(next: UpdateInstall) {
    this.progress = next;
    this.emit();
  }

  private async checkPublished(): Promise<UpdateCheck> {
    const currentVersion = this.options.currentVersion;
    this.published = undefined;
    const target = targets[`${this.options.platform}-${this.options.arch}`];
    if (!target) {
      return {
        status: 'unsupported',
        currentVersion,
        detail: `この環境向けのインストール版はまだ公開されていません。現在の配布対象は ${distributedTargets} です。`,
      };
    }
    const current = version(currentVersion);
    if (!current)
      return {
        status: 'error',
        currentVersion,
        reason: 'invalid',
        detail: '実行中のアプリのバージョンを確認できませんでした。',
      };
    try {
      const releases = await withDeadline(
        this.options.timeoutMs ?? 10000,
        '更新の確認がタイムアウトしました。接続を確認して再試行してください。',
        (signal) => this.readReleases(signal, current),
      );
      const candidates: (Published & { parsed: NonNullable<ReturnType<typeof version>> })[] = [];
      for (const release of releases) {
        const parsed = version(release.tag_name);
        if (release.draft || !parsed || release.prerelease !== (parsed.preview !== undefined))
          continue;
        const tag = release.tag_name;
        const releaseUrl = `${repository}/releases/tag/${tag}`;
        if (release.html_url !== releaseUrl) continue;
        const asset = (name: string): Asset | undefined => {
          const url = `${repository}/releases/download/${tag}/${name}`;
          const found = release.assets.find(
            (item) =>
              item.name === name && item.state === 'uploaded' && item.browser_download_url === url,
          );
          return found && { name, url, size: found.size };
        };
        const installer = asset(target.installer(parsed.text));
        if (!installer) continue;
        candidates.push({
          parsed,
          release: { version: parsed.text, tag, releaseUrl, downloadUrl: installer.url },
          package: asset(target.package(parsed.text)),
          checksums: asset(checksumsName),
        });
      }
      candidates.sort((a, b) => compare(b.parsed, a.parsed));
      const latest = candidates[0];
      if (!latest)
        return {
          status: 'error',
          currentVersion,
          reason: 'unavailable',
          detail:
            'この環境向けの公開インストーラーが見つかりませんでした。時間をおいて再試行してください。',
        };
      this.published = latest;
      // Published preview tags identify delivery iterations; the installed app's
      // package version is currently the core (e.g. 0.1.4 for v0.1.4-preview.1).
      const newer = compare(latest.parsed, current) > 0;
      if (!newer)
        return {
          status: 'current',
          currentVersion,
          release: latest.release,
          detail: 'このアプリより新しい公開版はありません。',
        };
      return {
        status: 'available',
        currentVersion,
        release: latest.release,
        detail: `${latest.release.version} を利用できます。`,
        install: await this.installable(latest),
      };
    } catch (error) {
      const known = error instanceof UpdateError;
      return {
        status: 'error',
        currentVersion,
        reason: known ? error.reason : 'offline',
        detail: known
          ? error.message
          : '更新情報に接続できませんでした。インターネット接続を確認して再試行してください。',
      };
    }
  }

  private async installable(published: Published): Promise<NonNullable<UpdateCheck['install']>> {
    const installer = this.options.installer;
    const detail =
      !installer || !this.options.directory
        ? 'この起動方法のアプリはアプリ内で更新できません。インストーラーを取得してください。'
        : !published.package || !published.checksums
          ? 'この公開版にはアプリ内で更新するためのファイルがありません。インストーラーを取得してください。'
          : await installer
              .unavailable()
              .catch(
                () =>
                  'アプリ内で更新できるか確認できませんでした。インストーラーを取得してください。',
              );
    return detail ? { available: false, detail } : { available: true };
  }

  private async readReleases(
    signal: AbortSignal,
    current: NonNullable<ReturnType<typeof version>>,
  ) {
    const releases = await this.readJson(officialReleasesEndpoint, signal, releasesSchema);
    // A newer release listed without files is read again from its own assets endpoint; an
    // older one could never be offered, so it costs no request.
    let lookups = 0;
    for (const release of releases) {
      const parsed = version(release.tag_name);
      if (release.assets.length || release.draft || !release.id || !parsed) continue;
      if (compare(parsed, current) <= 0 || lookups++ >= maxAssetLookups) continue;
      release.assets = await this.readJson(releaseAssetsEndpoint(release.id), signal, assetsSchema);
    }
    return releases;
  }

  private async readJson<T>(url: string, signal: AbortSignal, schema: z.ZodType<T>) {
    const response = await (this.options.fetch ?? fetch)(url, {
      signal,
      redirect: 'error',
      credentials: 'omit',
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (response.status === 403 || response.status === 429)
      throw new UpdateError(
        'rate-limited',
        '更新の確認が混み合っています。時間をおいて再試行してください。',
      );
    if (!response.ok)
      throw new UpdateError(
        'offline',
        '更新情報に接続できませんでした。時間をおいて再試行してください。',
      );
    const body = await readBody(response, signal, maxResponseBytes);
    let data: unknown;
    try {
      data = JSON.parse(body.toString('utf8'));
    } catch {
      throw invalid();
    }
    const result = schema.safeParse(data);
    if (!result.success) throw invalid();
    return result.data;
  }

  async open(target: UpdateTarget, openExternal: (url: string) => Promise<unknown>): Promise<void> {
    if (!this.published || (target !== 'release' && target !== 'download'))
      throw Error('更新を確認してから公開ページを開いてください。');
    // Both links were constructed from the fixed official repository and a
    // validated version/asset name, then matched against the public response.
    await openExternal(
      target === 'release' ? this.published.release.releaseUrl : this.published.release.downloadUrl,
    );
  }

  /**
   * Downloads, verifies and stages the release the latest check offered. Resolves true once
   * `restart` can switch to it, and false when it was cancelled or failed; the state says which.
   */
  install(): Promise<boolean> {
    if (this.switched) return Promise.resolve(true);
    if (this.installing) return this.installing.done;
    const published = this.published;
    const installer = this.options.installer;
    const directory = this.options.directory;
    if (
      !published?.package ||
      !published.checksums ||
      !installer ||
      !directory ||
      this.latest?.status !== 'available' ||
      this.latest.release?.version !== published.release.version ||
      this.latest.install?.available !== true
    )
      return Promise.reject(Error('更新を確認してから実行してください。'));
    const { version } = published.release;
    if (this.progress.phase === 'ready' && this.progress.version === version)
      return Promise.resolve(true);
    const controller = new AbortController();
    const item = published.package;
    const checksums = published.checksums;
    const done = this.apply(version, item, checksums, installer, directory, controller.signal)
      .then(
        () => {
          this.setProgress({ phase: 'ready', version });
          return true;
        },
        (error: unknown) => {
          if (error instanceof Cancelled) this.setProgress({ phase: 'idle' });
          else
            this.setProgress({
              phase: 'failed',
              version,
              detail:
                error instanceof UpdateError
                  ? error.message
                  : '更新ファイルをダウンロードできませんでした。接続を確認して再試行してください。',
            });
          return false;
        },
      )
      .finally(() => {
        this.installing = undefined;
      });
    this.installing = { controller, done };
    return done;
  }

  /** Abandons a download in progress; once the installer runs, it is left to finish. */
  async cancel(): Promise<void> {
    if (this.progress.phase === 'downloading') this.installing?.controller.abort();
  }

  /** Switches to the prepared version; the caller then lets this process exit. */
  async restart(): Promise<void> {
    if (this.progress.phase !== 'ready' || !this.options.installer)
      throw Error('更新の準備ができていません。');
    // A shutdown that failed after the switch is retried without switching twice: the new
    // version already waits for this process to exit.
    if (this.switched) return;
    await this.options.installer.restart();
    this.switched = true;
  }

  private async apply(
    version: string,
    item: Asset,
    checksums: Asset,
    installer: UpdateInstaller,
    directory: string,
    signal: AbortSignal,
  ) {
    this.setProgress({ phase: 'downloading', version, received: 0, total: item.size });
    const unavailable = await installer.unavailable();
    if (unavailable) throw new UpdateError('unavailable', unavailable);
    if (item.size > maxPackageBytes) throw invalid();
    await rm(directory, { recursive: true, force: true });
    const folder = path.join(directory, version);
    await mkdir(folder, { recursive: true });
    try {
      const digest = (await this.readChecksums(checksums, signal)).get(item.name);
      if (!digest)
        throw new UpdateError(
          'invalid',
          `公開版の ${checksumsName} に更新ファイルが載っていません。インストーラーを取得してください。`,
        );
      const file = path.join(folder, item.name);
      let shown = 0;
      const { sha1 } = await this.download(item, file, digest, signal, (received) => {
        const now = Date.now();
        if (received < item.size && now - shown < 200) return;
        shown = now;
        this.setProgress({ phase: 'downloading', version, received, total: item.size });
      });
      this.setProgress({ phase: 'preparing', version });
      try {
        await installer.prepare({ file, version, size: item.size, sha1 });
      } catch (error) {
        throw new UpdateError(
          'invalid',
          error instanceof Error ? error.message : '更新を準備できませんでした。',
        );
      }
    } finally {
      // The installer has taken what it needs from the download, or it failed.
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }

  // Follows GitHub's redirect from the release to its download host, over HTTPS only.
  private async request(url: string, signal: AbortSignal): Promise<Response> {
    let next = url;
    for (let hop = 0; hop < 6; hop++) {
      const target = new URL(next);
      if (target.protocol !== 'https:' || target.username || target.password) throw invalid();
      const response = await (this.options.fetch ?? fetch)(target.href, {
        signal,
        redirect: 'manual',
        credentials: 'omit',
        headers: { Accept: 'application/octet-stream' },
      });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        void response.body?.cancel().catch(() => {});
        next = new URL(location, target).href;
        continue;
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new UpdateError(
          'offline',
          '更新ファイルを取得できませんでした。時間をおいて再試行してください。',
        );
      }
      return response;
    }
    throw invalid();
  }

  private async readChecksums(item: Asset, signal: AbortSignal) {
    const body = await withDeadline(
      this.options.timeoutMs ?? 10000,
      '更新ファイルの確認がタイムアウトしました。接続を確認して再試行してください。',
      async (bounded) => readBody(await this.request(item.url, bounded), bounded, maxChecksumBytes),
      signal,
    );
    const sums = new Map<string, string>();
    for (const line of body.toString('utf8').split(/\r?\n/)) {
      if (!line) continue;
      // sha256sum's own format: the digest, then a space and a text or binary marker.
      const match = /^([a-f0-9]{64}) [ *](\S.*)$/.exec(line);
      if (!match) throw invalid();
      sums.set(match[2], match[1]);
    }
    return sums;
  }

  // Streams the package to `file`, hashing as it goes. A download that receives nothing for
  // `idleMs` is abandoned rather than given one deadline, since a slow connection is not an error.
  private async download(
    item: Asset,
    file: string,
    digest: string,
    signal: AbortSignal,
    onProgress: (received: number) => void,
  ) {
    const controller = new AbortController();
    let fail = (_error: Error) => {};
    const interrupted = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
    interrupted.catch(() => {});
    const stop = (error: Error) => {
      fail(error);
      controller.abort();
    };
    let idle: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(
        () =>
          stop(
            new UpdateError(
              'timeout',
              'ダウンロードが進まなくなりました。接続を確認して再試行してください。',
            ),
          ),
        this.options.idleMs ?? 60_000,
      );
    };
    const cancel = () => stop(new Cancelled());
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
    const handle = await openFile(file, 'wx');
    const sha256 = createHash('sha256');
    const sha1 = createHash('sha1');
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      arm();
      const response = await Promise.race([this.request(item.url, controller.signal), interrupted]);
      const length = response.headers.get('content-length');
      if ((length !== null && Number(length) !== item.size) || !response.body) {
        void response.body?.cancel().catch(() => {});
        throw mismatch();
      }
      reader = response.body.getReader();
      let received = 0;
      while (true) {
        const { value, done } = await Promise.race([reader.read(), interrupted]);
        if (done) break;
        arm();
        received += value.byteLength;
        if (received > item.size) throw mismatch();
        sha256.update(value);
        sha1.update(value);
        await handle.write(value);
        onProgress(received);
      }
      if (received !== item.size || sha256.digest('hex') !== digest) throw mismatch();
      return { sha1: sha1.digest('hex') };
    } finally {
      clearTimeout(idle);
      signal.removeEventListener('abort', cancel);
      controller.abort();
      void reader?.cancel().catch(() => {});
      await handle.close();
    }
  }
}
