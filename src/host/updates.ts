import { z } from 'zod';
import type { PublishedUpdate, UpdateCheck, UpdateTarget } from '../domain/updates';

const repository = 'https://github.com/DeL-TaiseiOzaki/irori';
export const officialReleasesEndpoint =
  'https://api.github.com/repos/DeL-TaiseiOzaki/irori/releases?per_page=100';
const maxResponseBytes = 2 * 1024 * 1024;
const versionPattern =
  /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.(0|[1-9]\d*))?$/;
const releasesSchema = z
  .array(
    z.object({
      tag_name: z.string().max(100),
      html_url: z.string().max(500),
      draft: z.boolean(),
      prerelease: z.boolean(),
      assets: z
        .array(
          z.object({
            name: z.string().max(200),
            browser_download_url: z.string().max(1000),
            state: z.string().max(30),
            size: z.number().int().positive(),
          }),
        )
        .max(100),
    }),
  )
  .max(100);

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
const invalid = () =>
  new UpdateError(
    'invalid',
    '公開版の情報を確認できませんでした。時間をおいて再試行してください。',
  );

export class UpdateService {
  private published?: PublishedUpdate;
  private pending?: Promise<UpdateCheck>;
  constructor(
    private readonly options: {
      currentVersion: string;
      platform: string;
      arch: string;
      fetch?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  check(): Promise<UpdateCheck> {
    if (this.pending) return this.pending;
    this.pending = this.checkPublished().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async checkPublished(): Promise<UpdateCheck> {
    const currentVersion = this.options.currentVersion;
    this.published = undefined;
    if (this.options.platform !== 'win32' || this.options.arch !== 'x64') {
      return {
        status: 'unsupported',
        currentVersion,
        detail:
          'この環境向けのインストール版はまだ公開されていません。現在の配布対象は Windows x64 です。',
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
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(
          new UpdateError(
            'timeout',
            '更新の確認がタイムアウトしました。接続を確認して再試行してください。',
          ),
        );
        controller.abort();
      }, this.options.timeoutMs ?? 10000);
    });
    try {
      const releases = await Promise.race([this.readReleases(controller.signal), deadline]);
      const candidates: {
        release: PublishedUpdate;
        parsed: NonNullable<ReturnType<typeof version>>;
      }[] = [];
      for (const release of releases) {
        const parsed = version(release.tag_name);
        if (release.draft || !parsed || release.prerelease !== (parsed.preview !== undefined))
          continue;
        const tag = release.tag_name;
        const releaseUrl = `${repository}/releases/tag/${tag}`;
        if (release.html_url !== releaseUrl) continue;
        const assetName = `irori-${parsed.text}-windows-x64-Setup.exe`;
        const downloadUrl = `${repository}/releases/download/${tag}/${assetName}`;
        if (
          !release.assets.some(
            (asset) =>
              asset.name === assetName &&
              asset.state === 'uploaded' &&
              asset.browser_download_url === downloadUrl,
          )
        )
          continue;
        candidates.push({
          parsed,
          release: { version: parsed.text, tag, releaseUrl, downloadUrl },
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
            'Windows x64 向けの公開インストーラーが見つかりませんでした。時間をおいて再試行してください。',
        };
      this.published = latest.release;
      // Published preview tags identify delivery iterations; the installed app's
      // package version is currently the core (e.g. 0.1.4 for v0.1.4-preview.1).
      const newer = compare(latest.parsed, current) > 0;
      return {
        status: newer ? 'available' : 'current',
        currentVersion,
        release: latest.release,
        detail: newer
          ? `${latest.release.version} を利用できます。`
          : 'このアプリより新しい公開版はありません。',
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
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  private async readReleases(signal: AbortSignal) {
    const response = await (this.options.fetch ?? fetch)(officialReleasesEndpoint, {
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
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > maxResponseBytes)) {
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
        if (size > maxResponseBytes) throw invalid();
        chunks.push(value);
      }
      const result = releasesSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!result.success) throw invalid();
      return result.data;
    } catch (error) {
      void reader.cancel().catch(() => {});
      if (error instanceof SyntaxError) throw invalid();
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
  }

  async open(target: UpdateTarget, openExternal: (url: string) => Promise<unknown>): Promise<void> {
    if (!this.published || (target !== 'release' && target !== 'download'))
      throw Error('更新を確認してから公開ページを開いてください。');
    // Both links were constructed from the fixed official repository and a
    // validated version/asset name, then matched against the public response.
    await openExternal(
      target === 'release' ? this.published.releaseUrl : this.published.downloadUrl,
    );
  }
}
