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

/** Text formats irori writes for agents and searches; kept beside the viewer list so the two never overlap. */
export const textFilePattern = /\.(md|txt|csv|json|ya?ml|toml|ts|js|css)$/i;

/**
 * Formats that are never text: archives, programs, media, fonts, databases and
 * the binary Office and design formats irori has no viewer for. Any other file
 * opens in the editor, as in VS Code, when its bytes are UTF-8 text (ADR 041).
 */
export const binaryFilePattern = new RegExp(
  `\\.(${[
    'zip|gz|tgz|bz2|xz|zst|7z|rar|tar|jar|war|apk|ipa|whl|egg|nupkg',
    'exe|dll|so|dylib|bin|o|a|lib|obj|class|pyc|pyo|wasm|node|msi|dmg|pkg|deb|rpm|iso|img|app',
    'mp3|wav|flac|ogg|oga|m4a|aac|wma|aiff|mp4|m4v|mov|avi|mkv|webm|wmv|flv|mpg|mpeg',
    'ico|icns|tif|tiff|heic|heif|raw|cr2|nef|psd|ai|sketch|fig|xd|eps|indd',
    'ttf|otf|woff|woff2|eot',
    'doc|dot|ppt|pps|pot|xlsb|pub|vsd|vsdx|key|numbers|pages|odt|odp|one|msg|eml',
    'sqlite|sqlite3|db|mdb|accdb|parquet|feather|npy|npz|pkl|pickle|h5|hdf5|onnx|pt|pth|safetensors|ckpt',
    'lnk|ds_store|gdoc|gsheet|gslides',
  ].join('|')})$`,
  'i',
);

/** The largest text the editor opens, saves, diffs or searches. */
export const textFileByteLimit = 2 * 1024 * 1024;

export const opensInIrori = (path: string) => !!viewerKind(path) || !binaryFilePattern.test(path);
