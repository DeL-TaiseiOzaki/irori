/**
 * Files the person attached to the instruction.
 *
 * Sent: just before the person's words, when they attached files. Images are
 * also handed to Claude Code, Codex, OpenCode and Pi as pictures; every file is
 * named here by its absolute path, so a CLI that takes no pictures can still
 * read it.
 * Channel: the request text.
 */
export function attachedFiles(files: { name: string; path: string; image: boolean }[]) {
  return (
    'The user attached these files to this message. They are copies kept by irori outside the workspace; read them from these paths and do not modify them:\n' +
    files
      .map(
        (file) =>
          `- ${JSON.stringify(file.path)}${file.image ? ' (image, also shown inline when supported)' : ''}`,
      )
      .join('\n')
  );
}
