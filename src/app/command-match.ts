import type { AgentCommand } from '../domain/types';

/** The CLI's commands and skills matching `query`: names that start with it, then the rest. */
export function matchCommands(commands: AgentCommand[], query: string) {
  const q = query.toLowerCase();
  const starts = commands.filter((item) => item.name.toLowerCase().startsWith(q));
  const contains = commands.filter(
    (item) => !item.name.toLowerCase().startsWith(q) && item.name.toLowerCase().includes(q),
  );
  return [...starts, ...contains].slice(0, 50);
}
