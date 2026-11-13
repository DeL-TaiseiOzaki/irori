/**
 * Finding words in the file on show (Ctrl+F): what counts as the same text. Case
 * and full-width ASCII do not matter, as in a browser's find; anything else is
 * matched as written. Folding keeps one code unit for one, so an offset in the
 * folded text is the same offset in the text on show.
 */
export function foldForFind(text: string): string {
  let folded = text.toLowerCase();
  if (folded.length !== text.length) {
    // A few characters lower-case to two (İ); those stay as they are.
    folded = '';
    for (const character of text) {
      const lower = character.toLowerCase();
      folded += lower.length === character.length ? lower : character;
    }
  }
  // Ｆｕｌｌ－ｗｉｄｔｈ ASCII and the ideographic space read as their ASCII forms.
  return folded.replace(/[\uff01-\uff5e\u3000]/g, (character) =>
    character === '\u3000'
      ? ' '
      : String.fromCharCode(character.charCodeAt(0) - 0xfee0).toLowerCase(),
  );
}

/** Where each occurrence of `query` starts in `text`, without overlaps, in order. */
export function findAll(text: string, query: string): number[] {
  const found: number[] = [];
  if (!query || !text) return found;
  const haystack = foldForFind(text);
  const needle = foldForFind(query);
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + needle.length)
  )
    found.push(at);
  return found;
}
