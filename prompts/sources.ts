/**
 * Materials the person selected for the instruction.
 *
 * Sent: before the person's words, when the instruction names source
 * observations; each is a retained, read-only snapshot of the bytes observed.
 * Channel: the request text.
 */
export function selectedSources(
  sources: { scopeId: string; path: string; sourceId: string; sha256: string; snapshot: string }[],
) {
  return (
    'Explicitly selected source observations (preserve native access permissions):\n' +
    sources.map((source) => JSON.stringify(source)).join('\n') +
    '\nRetained snapshots are read-only references: never modify them. Read these observed bytes when grounding an artifact; report if access is unavailable.'
  );
}
