import { z } from 'zod';

export const noteRef = z.object({
  scopeId: z.uuid(),
  path: z.string().min(1).max(4096),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type NoteRef = z.infer<typeof noteRef>;
export const trashedNote = noteRef.extend({
  id: z.uuid(),
  deletedAt: z.iso.datetime(),
});
export type TrashedNote = z.infer<typeof trashedNote>;

export function noteFilename(name: string) {
  const stem = name.replace(/\.md$/i, '');
  if (
    !stem.trim() ||
    /[\\/:*?"<>|\u0000-\u001f]/.test(stem) ||
    stem.startsWith('.') ||
    /[. ]$/.test(stem) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)
  )
    throw Error('ノート名には記号や末尾の空白を含まない名前を指定してください。');
  return `${stem}.md`;
}

const managedImage = /^_assets\/image-[a-f0-9]{64}\.(?:png|jpeg|gif|webp)$/;

/** Keep bytes stable: move only understood outgoing links, copying managed assets. */
export function imagesForNoteMove(text: string): string[] {
  const images = new Set<string>();
  const reject = () => {
    throw Error(
      '相対リンクを含むノートは別フォルダに移動できません。同じフォルダで名前を変更してください。',
    );
  };
  // Wiki embeds, HTML and reference links need dialect-aware relocation. A literal
  // code example may also trigger this conservative guard; never rewrite its bytes.
  if (/\[\[|\b(?:src|href)\s*=|^\s{0,3}\[[^\]]+\]:|\]\s*\[/im.test(text)) reject();
  for (const match of text.matchAll(/\]\(/g)) {
    const destination = /^(?:<([^<>]+)>|([^\s()]+))(?:\s+["'][^\n]*?["'])?\s*\)/.exec(
      text.slice(match.index + 2),
    );
    if (!destination) reject();
    const url = destination![1] ?? destination![2];
    if (/^(?:https?:|mailto:|#)/i.test(url)) continue;
    if (managedImage.test(url)) images.add(url);
    else reject();
  }
  return [...images];
}
