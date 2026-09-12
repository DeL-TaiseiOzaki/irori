/** Conservative rich-mode boundary. Everything else stays byte-oriented source. */
export function sourceOnly(text: string): string | undefined {
  if (text.startsWith('\uFEFF') || text.includes('\r'))
    return 'BOM・改行コードを保持するためソース表示';
  if (/^---\n/.test(text)) return 'フロントマターを保持するためソース表示';
  if (/\[\[|!\[\[|^>\s*\[!|^\s*<|^\s*:::|\$\$|\{[%{]|^\[\^[^\]]+\]:/m.test(text))
    return '拡張記法を保持するためソース表示';
  return undefined;
}
