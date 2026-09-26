/**
 * Files irori shows but does not edit: the host hands their bytes to the sandboxed
 * renderer, which draws them with a viewer for the format. Everything else still
 * opens in the external application.
 */
export type ViewerKind = 'pdf' | 'word' | 'slides' | 'sheet' | 'image';

const kinds: [RegExp, ViewerKind][] = [
  [/\.pdf$/i, 'pdf'],
  [/\.docx$/i, 'word'],
  [/\.pptx$/i, 'slides'],
  [/\.(xlsx|xlsm|xls|ods)$/i, 'sheet'],
  [/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i, 'image'],
];

export function viewerKind(path: string): ViewerKind | undefined {
  return kinds.find(([pattern]) => pattern.test(path))?.[1];
}

/** Large enough for scanned PDFs and image-heavy decks, small enough to hold in memory. */
export const viewerByteLimit = 100 * 1024 * 1024;

/** Text formats the editor opens; kept beside the viewer list so the two never overlap. */
export const textFilePattern = /\.(md|txt|csv|json|ya?ml|toml|ts|js|css)$/i;

export const opensInIrori = (path: string) => textFilePattern.test(path) || !!viewerKind(path);
