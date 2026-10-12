import { test } from 'node:test';
import assert from 'node:assert/strict';
import { broughtFileLimit, broughtFiles, readDropped, TooManyFiles } from '../src/app/dropped';

/** A file manager's entry, as the browser hands one over in a drop. */
const file = (name: string, text = name) => ({
  name,
  isFile: true,
  isDirectory: false,
  file: (success: (file: File) => void) => success(new File([text], name)),
});
/** A folder whose reader gives its entries in batches of two, then an empty batch. */
const folder = (name: string, children: object[]) => ({
  name,
  isFile: false,
  isDirectory: true,
  createReader() {
    let at = 0;
    return {
      readEntries(success: (entries: never[]) => void) {
        success(children.slice(at, (at += 2)) as never[]);
      },
    };
  },
});

test('A dropped folder comes with everything inside it, read in batches, without hidden entries', async () => {
  const read = await readDropped([
    folder('資料', [
      file('a.pdf'),
      file('.DS_Store'),
      folder('2026', [file('b.csv'), file('c.txt'), file('d.md')]),
      folder('.git', [file('HEAD')]),
      file('e.png'),
    ]),
    file('top.txt'),
    new File(['plain'], 'plain.txt'),
  ]);
  const names = (items: typeof read): unknown[] =>
    items.map((item) => ('file' in item ? item.name : [item.name, names(item.entries)]));
  assert.deepEqual(names(read), [
    ['資料', ['a.pdf', ['2026', ['b.csv', 'c.txt', 'd.md']], 'e.png']],
    'top.txt',
    'plain.txt',
  ]);
  assert.equal(broughtFiles(read), 7);
  const first = read[0];
  assert(!('file' in first));
  const pdf = first.entries[0];
  assert('file' in pdf);
  assert.equal(await pdf.file.text(), 'a.pdf');
});

test('A drop holding more files than the limit is refused whole', async () => {
  const many = Array.from({ length: broughtFileLimit + 1 }, (_, i) => file(`${i}.txt`));
  await assert.rejects(readDropped([folder('many', many)]), TooManyFiles);
});
