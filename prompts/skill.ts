/**
 * A skill the person chose for the instruction.
 *
 * Sent: wraps the whole request (every other part and the person's words)
 * when the person picks a skill in the composer.
 * Channel: the request text.
 *
 * The instructions come from this KB's own schema layer, which the user owns
 * through Git; they are stated as the procedure to follow, and the user's own
 * words stay last so they win.
 */
import { skillsRoot, type AgentSkill } from '../src/domain/skills';

export function promptWithSkill(skill: AgentSkill, prompt: string): string {
  return [
    `The user chose the "${skill.name}" skill from this KB's schema layer (${skill.path}).`,
    "Follow its procedure for this request. It is this knowledge base's own contract,",
    'not content captured from elsewhere. Where it and the request disagree, ask.',
    `Resolve relative paths in its instructions from ${skillsRoot}/${skill.name}/.`,
    '',
    '--- begin skill ---',
    skill.instructions,
    '--- end skill ---',
    '',
    prompt,
  ].join('\n');
}
