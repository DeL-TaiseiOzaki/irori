import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { FileService } from '../src/host/files';
import { chooseJapanese } from '../tests/fixtures/japanese-interface';

// A note's images as Obsidian keeps them: embeds `![[name.png]]` show the image
// beside the note or in its `_assets/`, alt text survives an edit, and an image
// pasted into a note in a folder without `_assets/` makes one there and shows
// where it was pasted. No provider or model process is started.

/** A PNG of one colour, written without a library. */
function png(width: number, height: number, rgb: [number, number, number]) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rows.set(rgb, y * (width * 3 + 1) + 1 + x * 3);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const base = await mkdtemp(path.join(tmpdir(), 'irori images UI 日本語 '));
const root = path.join(base, 'KB');
const projects = path.join(root, 'Knowledge_Base/projects');
const ideas = path.join(root, 'Knowledge_Base/ideas');
await mkdir(path.join(projects, '_assets'), { recursive: true });
await mkdir(ideas, { recursive: true });
await writeFile(path.join(projects, 'shot.png'), png(40, 20, [200, 60, 60]));
await writeFile(path.join(projects, '_assets/kept.png'), png(10, 10, [60, 160, 60]));
await writeFile(
  path.join(projects, 'plan.md'),
  '# Plan\n\n![[shot.png]]\n\n![[kept.png|80]]\n\n![[missing.png]]\n\n![a red block](shot.png)\n\nAfter\n',
);
await writeFile(path.join(ideas, 'idea.md'), '# Idea\n\nFirst line\n\nLast line\n');

const files = new FileService(path.join(base, 'device'));
await files.init();
await files.register(root, '画像KB', 'personal');
await chooseJapanese(files.dataDir);
const env = { ...process.env, IRORI_DATA_DIR: files.dataDir } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [
    ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '.',
  ],
  env,
});
const errors: string[] = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: '選択したスペースを開く' }).click();
  const editor = page.locator('.ProseMirror');
  const shown = (locator: ReturnType<typeof editor.locator>) =>
    locator.evaluateAll((images) =>
      images.map((image) => (image as HTMLImageElement).naturalWidth),
    );

  // Embeds show the image beside the note or in its `_assets/`, at a width when given;
  // one that names nothing stays its text.
  await page.getByRole('button', { name: 'projects', exact: true }).click();
  await page.getByRole('button', { name: 'plan', exact: true }).click();
  await expect(editor).toContainText('After');
  const embeds = editor.locator('.wiki-embed-image img');
  await expect.poll(() => shown(embeds)).toEqual([40, 10]);
  await expect(embeds.nth(1)).toHaveCSS('width', '80px');
  await expect(editor.locator('.wiki-embed.missing')).toHaveText('missing.png');

  // An edit keeps the alt text and the embeds as written.
  await editor.getByText('After').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' edited');
  await expect
    .poll(() => readFile(path.join(projects, 'plan.md'), 'utf8'))
    .toBe(
      '# Plan\n\n![[shot.png]]\n\n![[kept.png|80]]\n\n![[missing.png]]\n\n![a red block](shot.png)\n\nAfter edited\n',
    );

  // An image pasted into a note whose folder has no `_assets/` makes one there and
  // shows where it was pasted.
  await page.getByRole('button', { name: 'ideas', exact: true }).click();
  await page.getByRole('button', { name: 'idea', exact: true }).click();
  await expect(editor).toContainText('Last line');
  await editor.getByText('First line').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  const pasted = png(24, 12, [40, 120, 220]);
  await app.evaluate(
    async ({ clipboard, ClipboardItem }, bytes) => {
      await clipboard.write([
        new ClipboardItem({
          'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
        }),
      ]);
    },
    [...pasted],
  );
  await page.keyboard.press('ControlOrMeta+V');
  await expect.poll(() => shown(editor.locator('img'))).toEqual([24]);
  await expect
    .poll(() => readFile(path.join(ideas, 'idea.md'), 'utf8'))
    .toMatch(/^# Idea\n\nFirst line\n\n!\[\]\(_assets\/image-[a-f0-9]{64}\.png\)\n\nLast line\n$/);
  const assets = await readdir(path.join(ideas, '_assets'));
  expect(assets).toHaveLength(1);
  expect(assets[0]).toMatch(/^image-[a-f0-9]{64}\.png$/);

  expect(errors).toEqual([]);
  console.log(
    'Images UI smoke passed: embeds shown beside the note and from _assets at a width, a missing one as text, alt text kept through an edit, and a pasted image saved in a new _assets/ beside its note and shown where it was pasted.',
  );
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
