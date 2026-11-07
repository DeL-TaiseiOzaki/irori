/**
 * The parts of the Schema of the folder an agent works in that its CLI does not
 * load by itself, which irori gives it instead (ADR 058): the folder's
 * instructions when the CLI does not read AGENTS.md or reads only part of it,
 * the AGENTS.md of folders below it, its rules (`.claude/rules`, which only
 * Claude Code reads) and its skills when the CLI may not find them.
 *
 * Sent: after the shared Schema, to a vault agent and the irori agent on every
 * CLI that leaves something out. In full on a native session's first request,
 * whenever these parts changed since that session last heard them, and after the
 * CLI compacted the session; otherwise as one line. A session counts as having
 * heard them only once its CLI answered the request. A session that heard them
 * gets a line when they are gone.
 * Channel: the request text.
 */

export interface FolderSchemaPrompt {
  /** The folder the agent works in. */
  root: string;
  /** The CLI's name, as the words say what it leaves out. */
  cli: string;
  /**
   * The folder's AGENTS.md when the CLI does not read it (`text`, or `file` alone
   * when it is too long to send), or reads only its first `limit` bytes.
   */
  instructions?: { file: string; text?: string; limit?: number };
  /** AGENTS.md files of folders below the root, by their paths inside it. */
  nested: string[];
  /** The folder's rules, each with its text while they fit in the request. */
  rules: { file: string; text?: string }[];
  /** Skills of the folder the CLI may not find by itself. */
  skills: { name: string; description: string; path: string }[];
}

/** Whether there is anything to say. */
export function folderSchemaHasParts(schema: FolderSchemaPrompt) {
  return !!(
    schema.instructions ||
    schema.nested.length ||
    schema.rules.length ||
    schema.skills.length
  );
}

/** The parts in full. */
export function folderSchema(schema: FolderSchemaPrompt) {
  const parts = [
    `irori: parts of the Schema of the folder you work in (${schema.root}) that ${schema.cli} does not load by itself. Follow them as the rest of that Schema; they replace any version of them given earlier in this session.`,
  ];
  const instructions = schema.instructions;
  if (instructions?.text !== undefined)
    parts.push(
      `This folder's instructions (${instructions.file}):\n<folder-instructions>\n${instructions.text}\n</folder-instructions>`,
    );
  else if (instructions?.limit)
    parts.push(
      `${schema.cli} loads only the first ${instructions.limit} bytes of this folder's instructions. Read the whole of ${instructions.file} first and follow all of it.`,
    );
  else if (instructions)
    parts.push(`Read this folder's instructions at ${instructions.file} first.`);
  if (schema.nested.length)
    parts.push(
      `These folders have instructions of their own. Before you read or change a file inside one of them, read its AGENTS.md and follow it there, beside this folder's:\n${schema.nested
        .map((file) => `- ${file}`)
        .join('\n')}`,
    );
  const sent = schema.rules.filter((rule) => rule.text !== undefined);
  const unsent = schema.rules.filter((rule) => rule.text === undefined);
  if (sent.length)
    parts.push(
      `This folder's rules. A rule whose front matter names paths applies to those files only:\n${sent
        .map((rule) => `<folder-rule file="${rule.file}">\n${rule.text}\n</folder-rule>`)
        .join('\n')}`,
    );
  if (unsent.length)
    parts.push(
      `Read this folder's rules first. A rule whose front matter names paths applies to those files only:\n${unsent
        .map((rule) => `- ${rule.file}`)
        .join('\n')}`,
    );
  if (schema.skills.length)
    parts.push(
      `This folder's skills. Read a skill's SKILL.md when the task matches it:\n${schema.skills
        .map((skill) => `- ${skill.name}: ${skill.description} (${skill.path})`)
        .join('\n')}`,
    );
  return parts.join('\n\n');
}

/** The line a session that already heard the unchanged parts gets instead. */
export function folderSchemaPointer(root: string) {
  return `irori: the parts of the Schema of ${root} given earlier in this session still apply, unchanged.`;
}

/** The line a session that heard such parts gets once none are left to give. */
export function folderSchemaRemoved(root: string) {
  return `irori: the parts of the Schema of ${root} given earlier in this session are gone. Follow that folder's Schema as its files are now.`;
}

/**
 * For a CLI whose session keeps the AGENTS.md it began with (Hermes Agent): the
 * folder's instructions changed since, so the session hears them again, whole
 * while they fit and otherwise as the file to read.
 */
export function folderInstructionsChanged(file: string, text?: string) {
  return text === undefined
    ? `irori: this folder's instructions (${file}) changed since this session began. Read the whole file again and follow it instead of the copy you began with.`
    : `irori: this folder's instructions (${file}) changed since this session began. Follow this text instead of the copy you began with:\n<folder-instructions>\n${text}\n</folder-instructions>`;
}

/** The line a request gets when irori could not read the folder's Schema for it. */
export function folderSchemaUnread(root: string) {
  return `irori: the Schema of ${root} could not be read for this request. Keep following what was given earlier in this session, and read its AGENTS.md and .claude/rules there yourself.`;
}

/**
 * For Claude Code when it did not load the folder's AGENTS.md this session (a
 * CLAUDE.md beside it, an older version, another provider): the instructions,
 * whole while they fit and otherwise as the file to read.
 */
export function folderInstructionsMissing(cli: string, file: string, text?: string) {
  return text === undefined
    ? `irori: ${cli} did not load this folder's instructions (${file}). Read the whole file first and follow it.`
    : `irori: ${cli} did not load this folder's instructions (${file}). Follow them:\n<folder-instructions>\n${text}\n</folder-instructions>`;
}
