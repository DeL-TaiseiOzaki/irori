import { promises as fs } from 'node:fs';
import path from 'node:path';
import { FileService, hash } from './files';
import { classify } from '../domain/scopes';
import { SerialQueue } from './serial-queue';
import { writeLocalFile } from './local-json';
import { t } from '../domain/i18n';

export const imageLimit = 20 * 1024 * 1024;
export function imageType(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  if (b.length > imageLimit)
    throw Error(t('画像は 20 MiB 以下にしてください。', 'Images must be 20 MiB or smaller.'));
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'jpeg';
  if (/^GIF8[79]a$/.test(b.subarray(0, 6).toString())) return 'gif';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP')
    return 'webp';
  throw Error(
    t('PNG・JPEG・GIF・WebP の画像を選択してください。', 'Choose a PNG, JPEG, GIF or WebP image.'),
  );
}
export function imagePath(note: string, url: string) {
  const decoded = decodeURIComponent(url);
  if (!decoded || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(decoded) || /[\\\0?#]/.test(decoded))
    throw Error(
      t(
        'ノート内の相対画像パスを指定してください。',
        'Give a relative image path inside the note.',
      ),
    );
  return path.posix.normalize(path.posix.join(path.posix.dirname(note), decoded));
}
/** What ImageService needs from CloudService to reach into a Drive connection. */
export interface ImageCloudHooks {
  /** Resolves a Drive-connected path to its real filesystem location, mount verified. */
  resolve(scopeId: string, rel: string): Promise<string>;
  /** Whether the connection covering rel is mounted so that it can be changed. */
  writable(scopeId: string, rel: string): boolean;
}
export class ImageService {
  private queue = new SerialQueue();
  constructor(
    private files: FileService,
    private cloud?: ImageCloudHooks,
  ) {}
  save(scopeId: string, note: string, bytes: Uint8Array) {
    return this.queue.run(() => this.saveBytes(scopeId, note, bytes));
  }
  // A workspace scope holds only Drive connections and FileService does not know it;
  // every other scope is a registered KB, where only its `contents` layer is Drive-backed.
  private resolvePath(scopeId: string, rel: string) {
    if (this.files.list().some((space) => space.scopeId === scopeId))
      return this.files.resolve(scopeId, rel);
    if (!this.cloud) throw Error('Unknown space');
    return this.cloud.resolve(scopeId, rel);
  }
  private isDrive(scopeId: string, note: string) {
    if (!this.files.list().some((space) => space.scopeId === scopeId)) return true;
    return classify(this.files.get(scopeId), note) === 'contents';
  }
  private async saveBytes(scopeId: string, note: string, bytes: Uint8Array) {
    const ext = imageType(bytes);
    if (!/\.md$/i.test(note))
      throw Error(
        t(
          '編集できる Markdown ノートに画像を追加してください。',
          'Add images to an editable Markdown note.',
        ),
      );
    const drive = this.isDrive(scopeId, note);
    if (drive && !this.cloud)
      throw Error(
        t(
          '編集できる Markdown ノートに画像を追加してください。',
          'Add images to an editable Markdown note.',
        ),
      );
    // Resolving first verifies the mount, which is also what lets the writable check
    // below answer correctly for a connection not yet touched in this process.
    const filename = await this.resolvePath(scopeId, note);
    if (drive && this.cloud && !this.cloud.writable(scopeId, note))
      throw Error(
        t(
          'このクラウドフォルダは読み取り専用で接続されています。',
          'This cloud folder is connected read-only.',
        ),
      );
    const relDir = path.posix.join(path.posix.dirname(note), '_assets');
    const directory = path.join(path.dirname(filename), '_assets');
    // Check existing aliases before any write; never create a disconnected cloud fallback.
    await fs.mkdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const actual = await this.resolvePath(scopeId, relDir);
    if (actual !== directory || (await fs.lstat(directory)).isSymbolicLink())
      throw Error(
        t('_assets は通常のフォルダにしてください。', '_assets must be an ordinary folder.'),
      );
    const name = `image-${hash(Buffer.from(bytes))}.${ext}`;
    const target = path.join(directory, name);
    try {
      const stat = await fs.lstat(target);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        hash(await fs.readFile(target)) !== hash(Buffer.from(bytes))
      )
        throw Error(
          t('保存先の画像が変更されています。', 'The image at the destination has changed.'),
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (drive)
        // Drive has no atomic rename: replacing a file there deletes and re-creates it.
        // The file is new either way, so an exclusive direct write is enough.
        await fs.writeFile(target, Buffer.from(bytes), { flag: 'wx' });
      else await writeLocalFile(target, Buffer.from(bytes));
    }
    return `_assets/${name}`;
  }
  async read(scopeId: string, note: string, url: string) {
    await this.resolvePath(scopeId, note);
    const filename = await this.resolvePath(scopeId, imagePath(note, url));
    if ((await fs.stat(filename)).size > imageLimit)
      throw Error(t('画像は 20 MiB 以下にしてください。', 'Images must be 20 MiB or smaller.'));
    const bytes = await fs.readFile(filename);
    return `data:image/${imageType(bytes)};base64,${bytes.toString('base64')}`;
  }
}
