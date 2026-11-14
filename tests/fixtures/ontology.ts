/**
 * A small vocabulary in the shape `.property/property.json` takes: types with a
 * meaning and required keys, and relations that say which types they go from
 * and which they point at (ADR 060).
 */
export const vocabulary = {
  schemaVersion: 1,
  properties: {
    type: { kind: 'type' },
    title: { kind: 'text' },
    description: { kind: 'text' },
    sources: { kind: 'sources' },
    relations: { kind: 'relations' },
  },
  required: ['type', 'title'],
  types: {
    concept: { description: 'One reusable claim.', heading: '# Concepts', required: ['sources'] },
    person: { description: 'The record of a person.', heading: '# People', required: [] },
    org: {
      description: 'The record of an organization.',
      heading: '# Organizations',
      required: [],
    },
    project: { description: 'The record of a project.', heading: '# Projects', required: [] },
  },
  relations: {
    about: {
      description: 'The record this page is about.',
      from: 'any',
      to: ['person', 'org', 'project'],
    },
    part_of: {
      description: 'This record belongs to the target.',
      from: ['person', 'org', 'project'],
      to: ['org', 'project'],
    },
    uses: {
      description: 'What this page describes depends on the target.',
      from: 'any',
      to: 'page',
    },
    same_as: {
      description: 'The same identity elsewhere.',
      from: ['person', 'org', 'project'],
      to: 'url',
    },
  },
  avoid: [
    { name: 'depends_on', use: 'uses' },
    { name: 'synthesis', use: 'concept' },
  ],
};

/** A page's text with this frontmatter. */
export const page = (
  fields: { type?: string; title?: string; description?: string; sources?: boolean },
  relations: string[] = [],
  body = 'Body.\n',
) =>
  `---\n${fields.type === undefined ? '' : `type: ${fields.type}\n`}${
    fields.title === undefined ? '' : `title: ${fields.title}\n`
  }${fields.description === undefined ? '' : `description: ${fields.description}\n`}${
    fields.sources ? 'sources:\n  - { id: s, resource: https://example.com/source }\n' : ''
  }${
    relations.length ? `relations:\n${relations.map((entry) => `  - ${entry}`).join('\n')}\n` : ''
  }---\n\n${body}`;
