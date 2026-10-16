import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import JSZip from 'jszip';
import { t } from '../domain/i18n';

/**
 * The uv irori downloads when the person adds Python for routines (ADR 016 D3).
 * Each archive's size and SHA-256 are pinned here, as GitHub lists them for
 * this release, so a download that differs is refused before anything runs.
 */
export const uvVersion = '0.12.21';
export interface UvRelease {
  name: string;
  size: number;
  sha256: string;
}
const releases: Record<string, UvRelease> = {
  'darwin-arm64': {
    name: 'uv-aarch64-apple-darwin.tar.gz',
    size: 17001427,
    sha256: 'b88bda573e566ef9bced66b155fe0408626fbbc053aee1c30ba686f0728c9447',
  },
  'darwin-x64': {
    name: 'uv-x86_64-apple-darwin.tar.gz',
    size: 20741769,
    sha256: '2b336763b396ec6afa20c5a8b083538ca7402445b868311979d740a4344c17d8',
  },
  'linux-arm64': {
    name: 'uv-aarch64-unknown-linux-gnu.tar.gz',
    size: 18943621,
    sha256: '030b69227b40af8c1981b7301793dc66e71ed3c796ea8688209dd268bd91ec51',
  },
  'linux-x64': {
    name: 'uv-x86_64-unknown-linux-gnu.tar.gz',
    size: 19782662,
    sha256: '23f02075b652bb1df64178cfae41b5caf160822e720e2663568f3f5d63bc52c0',
  },
  'win32-arm64': {
    name: 'uv-aarch64-pc-windows-msvc.zip',
    size: 19274675,
    sha256: '93ed53b94e9cec000cacdfd18ca67bc4cb2b6a5f5ec041edd7f2a3dae365ce79',
  },
  'win32-x64': {
    name: 'uv-x86_64-pc-windows-msvc.zip',
    size: 17992232,
    sha256: '5d223efa0bf00208c3853246af09420419dfbd352536aa6bb8163d6170e23890',
  },
};

/** The uv archive for this device, or undefined where uv publishes none. */
export function uvRelease(platform: string = process.platform, arch: string = process.arch) {
  return releases[`${platform}-${arch}`];
}

/** The file named `name`, at any depth, in a gzipped tar archive. */
export function fromTarGz(archive: Buffer, name: string) {
  const tar = gunzipSync(archive, { maxOutputLength: 256 * 1024 * 1024 });
  const field = (header: Buffer, start: number, length: number) =>
    header
      .subarray(start, start + length)
      .toString('utf8')
      .replace(/\0[\s\S]*$/, '');
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const prefix = field(header, 345, 155);
    const entry = (prefix ? `${prefix}/` : '') + field(header, 0, 100);
    const size = parseInt(field(header, 124, 12).trim() || '0', 8);
    const type = field(header, 156, 1);
    const start = offset + 512;
    if (!Number.isFinite(size) || start + size > tar.length) break;
    if ((type === '0' || type === '') && path.posix.basename(entry) === name)
      return Buffer.from(tar.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return undefined;
}

/** The file named `name` at the top of a zip archive. */
export async function fromZip(archive: Buffer, name: string) {
  return (await JSZip.loadAsync(archive)).file(name)?.async('nodebuffer');
}

const cannotDownload = () =>
  Error(t('uv をダウンロードできませんでした。', 'Could not download uv.'));
const mismatch = () =>
  Error(
    t(
      'ダウンロードした uv が想定と一致しません。',
      'The downloaded uv did not match the expected file.',
    ),
  );

export interface PythonRuntimeOptions {
  dataDir: string;
  fetch?: typeof fetch;
  /** The archive to download in place of this device's, for tests. */
  release?: UvRelease;
  platform?: string;
}

/**
 * Python for routines (ADR 016 D3): uv in `<irori data>/runtimes/`, added only
 * when the person chooses it. uv then keeps Python and each script's
 * dependencies there too, and never reads the person's own uv configuration.
 */
export class PythonRuntime {
  private installing?: Promise<string>;
  constructor(private options: PythonRuntimeOptions) {}
  private get dir() {
    return path.join(this.options.dataDir, 'runtimes');
  }
  private get executable() {
    const platform = this.options.platform ?? process.platform;
    return path.join(this.dir, 'uv', uvVersion, platform === 'win32' ? 'uv.exe' : 'uv');
  }
  /** uv, when it was added on this device. */
  async uv() {
    const stat = await fs.stat(this.executable).catch(() => undefined);
    return stat?.isFile() ? this.executable : undefined;
  }
  /** What a `.py` step's uv is given, so everything it fetches stays in irori's data. */
  env(): Record<string, string> {
    return {
      UV_PYTHON_INSTALL_DIR: path.join(this.dir, 'python'),
      UV_CACHE_DIR: path.join(this.dir, 'uv-cache'),
      UV_PYTHON_PREFERENCE: 'only-managed',
      UV_NO_CONFIG: '1',
      UV_NO_PROGRESS: '1',
    };
  }
  /** Downloads uv unless it is here already; one download at a time. */
  install() {
    this.installing ??= this.download().finally(() => {
      this.installing = undefined;
    });
    return this.installing;
  }
  private async download() {
    const found = await this.uv();
    if (found) return found;
    const release = this.options.release ?? uvRelease(this.options.platform);
    if (!release)
      throw Error(
        t('この端末には Python を追加できません。', 'Python cannot be added on this device.'),
      );
    const archive = await this.fetchArchive(release);
    const bytes = release.name.endsWith('.zip')
      ? await fromZip(archive, 'uv.exe')
      : fromTarGz(archive, 'uv');
    if (!bytes) throw mismatch();
    const target = this.executable;
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}`;
    try {
      await fs.writeFile(temporary, bytes, { mode: 0o755, flag: 'wx' });
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return target;
  }
  /** The archive from uv's GitHub release, over HTTPS only, checked against its pinned digest. */
  private async fetchArchive(release: UvRelease) {
    const request = this.options.fetch ?? fetch;
    const signal = AbortSignal.timeout(10 * 60_000);
    let next = `https://github.com/astral-sh/uv/releases/download/${uvVersion}/${release.name}`;
    for (let hop = 0; hop < 6; hop++) {
      const target = new URL(next);
      if (target.protocol !== 'https:' || target.username || target.password)
        throw cannotDownload();
      const response = await request(target.href, {
        signal,
        redirect: 'manual',
        credentials: 'omit',
        headers: { Accept: 'application/octet-stream' },
      }).catch(() => {
        throw cannotDownload();
      });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        void response.body?.cancel().catch(() => {});
        next = new URL(location, target).href;
        continue;
      }
      if (!response.ok || !response.body) {
        void response.body?.cancel().catch(() => {});
        throw cannotDownload();
      }
      const reader = response.body.getReader();
      const hash = createHash('sha256');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read().catch(() => {
            throw cannotDownload();
          });
          if (done) break;
          size += value.byteLength;
          if (size > release.size) throw mismatch();
          hash.update(value);
          chunks.push(value);
        }
      } finally {
        void reader.cancel().catch(() => {});
      }
      if (size !== release.size || hash.digest('hex') !== release.sha256) throw mismatch();
      return Buffer.concat(chunks);
    }
    throw cannotDownload();
  }
}
