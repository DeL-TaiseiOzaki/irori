/** The last part of a slash-separated path: a file's or folder's name. */
export function baseName(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The folder a slash-separated path is in; '' at the top. */
export function parentPath(path: string) {
  return path.slice(0, Math.max(path.lastIndexOf('/'), 0));
}
