import { promises as fs } from 'node:fs';
import path from 'node:path';
import { FileService, hash } from './files';
import { classify } from '../domain/scopes';
import { SerialQueue } from './serial-queue';
import { writeLocalFile } from './local-json';

export const imageLimit = 20 * 1024 * 1024;
export function imageType(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  if (b.length > imageLimit) throw Error('画像は 20 MiB 以下にしてください。');
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'jpeg';
  if (/^GIF8[79]a$/.test(b.subarray(0, 6).toString())) return 'gif';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP')
    return 'webp';
  throw Error('PNG・JPEG・GIF・WebP の画像を選択してください。');
}
export function imagePath(note: string, url: string) {
  const decoded = decodeURIComponent(url);
  if (!decoded || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(decoded) || /[\\\0?#]/.test(decoded))
    throw Error('ノート内の相対画像パスを指定してください。');
  return path.posix.normalize(path.posix.join(path.posix.dirname(note), decoded));
}
export class ImageService {
  private queue = new SerialQueue();
  constructor(
    private files: FileService,
    private resolve = files.resolve.bind(files),
  ) {}
  save(scopeId: string, note: string, bytes: Uint8Array) {
    return this.queue.run(() => this.saveBytes(scopeId, note, bytes));
  }
  private async saveBytes(scopeId: string, note: string, bytes: Uint8Array) {
    const ext = imageType(bytes);
    if (!/\.md$/i.test(note) || classify(this.files.get(scopeId), note) === 'contents')
      throw Error('編集できる Markdown ノートに画像を追加してください。');
    const filename = await this.files.resolve(scopeId, note);
    const relDir = path.posix.join(path.posix.dirname(note), '_assets');
    const directory = path.join(path.dirname(filename), '_assets');
    // Check existing aliases before any write; never create a disconnected cloud fallback.
    await fs.mkdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const actual = await this.files.resolve(scopeId, relDir);
    if (actual !== directory || (await fs.lstat(directory)).isSymbolicLink())
      throw Error('_assets は通常のフォルダにしてください。');
    const name = `image-${hash(Buffer.from(bytes))}.${ext}`;
    const target = path.join(directory, name);
    try {
      const stat = await fs.lstat(target);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        hash(await fs.readFile(target)) !== hash(Buffer.from(bytes))
      )
        throw Error('保存先の画像が変更されています。');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await writeLocalFile(target, Buffer.from(bytes));
    }
    return `_assets/${name}`;
  }
  async read(scopeId: string, note: string, url: string) {
    await this.resolve(scopeId, note);
    const filename = await this.resolve(scopeId, imagePath(note, url));
    if ((await fs.stat(filename)).size > imageLimit)
      throw Error('画像は 20 MiB 以下にしてください。');
    const bytes = await fs.readFile(filename);
    return `data:image/${imageType(bytes)};base64,${bytes.toString('base64')}`;
  }
}
