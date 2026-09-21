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

/**
 * The managed images to copy beside a note that changes folder. Wiki embeds and
 * HTML need dialect-aware relocation, so they refuse the move; a literal code
 * example may trigger that guard too. Other relative links refuse it as well
 * unless they are being rewritten for the new location.
 */
export function imagesForNoteMove(text: string, rewriting = false): string[] {
  const images = new Set<string>();
  const reject = () => {
    throw Error(
      rewriting
        ? 'Wiki リンクや HTML を含むノートは別フォルダに移動できません。同じフォルダで名前を変更してください。'
        : '相対リンクを含むノートは、リンクを更新せずに別フォルダへ移動できません。「リンクも更新する」を有効にするか、同じフォルダで名前を変更してください。',
    );
  };
  if (/\[\[|\b(?:src|href)\s*=/i.test(text)) reject();
  if (!rewriting && /^\s{0,3}\[[^\]]+\]:|\]\s*\[/m.test(text)) reject();
  for (const match of text.matchAll(/\]\(/g)) {
    const destination = /^(?:<([^<>]+)>|([^\s()]+))(?:\s+["'][^\n]*?["'])?\s*\)/.exec(
      text.slice(match.index + 2),
    );
    const url = destination?.[1] ?? destination?.[2];
    if (url === undefined || /^(?:https?:|mailto:|#)/i.test(url)) {
      if (url === undefined && !rewriting) reject();
      continue;
    }
    if (managedImage.test(url)) images.add(url);
    else if (!rewriting) reject();
  }
  return [...images];
}
