/**
 * The shared Schema: instructions, rules and skills every agent in irori
 * follows beside its own Schema, kept in the irori agent's folder and written
 * through the settings (ADR 027, ADR 048). Its hooks reach Claude Code as
 * settings, not as words.
 *
 * Sent: first in every request, to the irori agent, a vault agent and a
 * routine's agent step alike. In full on a native session's first request and
 * whenever the shared Schema changed since that session last heard it;
 * otherwise as one line pointing at it.
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
    `irori: the shared Schema, which every agent in irori follows beside the Schema of the folder it works in. Where the two differ, that folder's Schema wins. The shared Schema's folder is ${shared.root}.`,
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
