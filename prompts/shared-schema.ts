/**
 * The shared Schema: instructions, rules and skills every agent in irori
 * follows beside its own Schema, kept in the irori agent's folder and written
 * through the settings (ADR 027, ADR 048). Its hooks are not words: Claude Code
 * gets them as settings, and irori runs them for every other CLI (ADR 058).
 *
 * Sent: first in every request, to the irori agent, a vault agent and a
 * routine's agent step alike. In full on a native session's first request,
 * whenever the shared Schema changed since that session last heard it, and
 * after the CLI compacted the session; otherwise as one line pointing at it.
 * A session counts as having heard it only once its CLI answered the request
 * (ADR 058). A session that heard one gets a line when it is gone.
 * Channel: the request text, before the parts it would otherwise lead.
 */

export interface SharedSchemaPrompt {
  /** The shared Schema's folder. */
  root: string;
  /** Its instructions file. */
  file: string;
  /** The instructions, absent when there are none or they are too long to send. */
  instructions?: string;
  /** The instructions exist but are long, so the agent reads the file instead. */
  long?: boolean;
  /** Each rule's file, with its text while the rules fit in the request. */
  rules: { file: string; text?: string }[];
  skills: { name: string; description: string; path: string }[];
}

/** The shared Schema in full. */
export function sharedSchema(shared: SharedSchemaPrompt) {
  const parts = [
    `irori: the shared Schema, which every agent in irori follows beside the Schema of the folder it works in. Where the two differ, that folder's Schema wins. It replaces any version of it given earlier in this session. The shared Schema's folder is ${shared.root}.`,
  ];
  if (shared.instructions)
    parts.push(
      `Shared instructions (${shared.file}):\n<shared-instructions>\n${shared.instructions}\n</shared-instructions>`,
    );
  else if (shared.long) parts.push(`Read the shared instructions at ${shared.file} first.`);
  const sent = shared.rules.filter((rule) => rule.text !== undefined);
  const unsent = shared.rules.filter((rule) => rule.text === undefined);
  if (sent.length)
    parts.push(
      `Shared rules. A rule whose front matter names paths applies to those files only:\n${sent
        .map((rule) => `<shared-rule file="${rule.file}">\n${rule.text}\n</shared-rule>`)
        .join('\n')}`,
    );
  if (unsent.length)
    parts.push(
      `Read the shared rules first. A rule whose front matter names paths applies to those files only:\n${unsent
        .map((rule) => `- ${rule.file}`)
        .join('\n')}`,
    );
  if (shared.skills.length)
    parts.push(
      `Shared skills. Read a skill's SKILL.md when the task matches it:\n${shared.skills
        .map((skill) => `- ${skill.name}: ${skill.description} (${skill.path})`)
        .join('\n')}`,
    );
  return parts.join('\n\n');
}

/** The line a session that already heard the unchanged shared Schema gets instead. */
export function sharedSchemaPointer(shared: Pick<SharedSchemaPrompt, 'root'>) {
  return `irori: the shared Schema given earlier in this session still applies, unchanged. Its folder is ${shared.root}.`;
}

/** The line a session that heard a shared Schema gets once the shared Schema is gone. */
export function sharedSchemaRemoved() {
  return 'irori: the shared Schema given earlier in this session no longer exists. Stop following it; the Schema of the folder you work in still applies.';
}

/** The line a request gets when irori could not read the shared Schema for it. */
export function sharedSchemaUnread() {
  return 'irori: the shared Schema could not be read for this request. Keep following it as given earlier in this session, if it was; nothing in it was removed.';
}
