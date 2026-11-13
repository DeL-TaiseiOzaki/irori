import { compareCodePoints, type FolderIndexStatus, type PageFacts } from './bundle';
import { resolveNoteLink } from './note-links';
import { requiredKeys, type PropertyDeclaration } from './properties';

/**
 * The ontology of a knowledge base (ADR 060): the kinds of pages it has and how
 * they may relate, as `.property/property.json` declares them — its types, each
 * with a meaning and the keys it requires, and its relations, each with a
 * meaning, the types it goes from and what it points at. The pages are
 * instances of it, not part of it. irori applies the declaration to the pages
 * and says where they part; it draws no graph of the pages themselves.
 */

/** What a relation points at: any page, a URL, or a page of one of these types. */
export type RelationTarget = 'page' | 'url' | string[];

export function relationTarget(to: string | string[] | undefined): RelationTarget {
  if (Array.isArray(to)) return to;
  return to === 'url' ? 'url' : 'page';
}

/** The declared relations a page of `type` may carry, without the names to avoid. */
export function relationsFrom(declaration: PropertyDeclaration, type: string | undefined) {
  const avoided = new Set(declaration.avoid.map((entry) => entry.name));
  return Object.entries(declaration.relations)
    .filter(
      ([name, entry]) =>
        !avoided.has(name) &&
        (!entry.from || entry.from === 'any' || (!!type && entry.from.includes(type))),
    )
    .map(([name]) => name);
}

/** One way a page parts from the declaration. */
export type OntologyParting =
  | { kind: 'unreadable' }
  | { kind: 'type-missing' }
  /** `use` is what the declaration's `avoid` list says to write instead. */
  | { kind: 'type-undeclared'; name: string; use?: string }
  | { kind: 'key-missing'; name: string }
  | { kind: 'relation-incomplete' }
  | { kind: 'relation-undeclared'; name: string; use?: string }
  /** The relation does not go from a page of this type. */
  | { kind: 'relation-from'; name: string; type: string }
  /** The relation points at a URL, and this target is not one. */
  | { kind: 'relation-not-url'; name: string; target: string }
  /** The relation points at a page, and this target is no page of the knowledge base. */
  | { kind: 'relation-not-page'; name: string; target: string }
  /** The relation points at pages of other types than the target's. */
  | { kind: 'relation-target-type'; name: string; target: string; type?: string }
  | { kind: 'relation-repeated'; name: string; target: string };

/** Where a page parts from the declaration. */
export type OntologyFinding = { path: string; title?: string } & OntologyParting;

export interface OntologyType {
  name: string;
  description?: string;
  /** The keys a page of this type must carry, the ones every page carries included. */
  required: string[];
  pages: number;
}

export interface OntologyRelation {
  name: string;
  description?: string;
  from: 'any' | string[];
  to: RelationTarget;
  /** How many times pages state it, and how many findings name it. */
  uses: number;
  findings: number;
}

/** A name pages use that the declaration does not have. */
export interface UndeclaredName {
  name: string;
  count: number;
  use?: string;
}

/** The declaration applied to the pages. */
export interface OntologyReport {
  types: OntologyType[];
  relations: OntologyRelation[];
  avoid: { name: string; use: string }[];
  pages: number;
  undeclaredTypes: UndeclaredName[];
  undeclaredRelations: UndeclaredName[];
  /** The first `findingLimit` findings in page order, and how many there are in all. */
  findings: OntologyFinding[];
  findingCount: number;
}

export const findingLimit = 500;

/** What the ontology view shows for one knowledge base. */
export interface Ontology {
  /** `.property/property.json` reads. Without it there is nothing to apply. */
  declared: boolean;
  /** Why a declaration that exists could not be used. */
  problem?: string;
  report?: OntologyReport;
  /** The folder indexes of an OKF bundle (ADR 028); absent when the knowledge folder is not one. */
  indexes?: FolderIndexStatus;
  /** The graph index an irori before 0.2.65 generated is still in the knowledge folder, at this path. */
  formerGraphIndex?: string;
}

const own = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

/**
 * Applies the declaration to the pages: every page has a declared type and the
 * keys that type requires, and every relation has a declared name, goes from a
 * type that may carry it and points at what the declaration says. Reads
 * nothing but the facts it is given, so the same pages give the same report.
 */
export function checkOntology(
  declaration: PropertyDeclaration,
  given: PageFacts[],
): OntologyReport {
  const avoid = new Map(declaration.avoid.map(({ name, use }) => [name, use]));
  const pages = given
    .map((page) => ({ ...page, path: page.path.normalize('NFC') }))
    .sort((a, b) => compareCodePoints(a.path, b.path));
  const byPath = new Map(pages.map((page) => [page.path, page]));
  const typePages = new Map<string, number>();
  const relationUses = new Map<string, number>();
  const relationFindings = new Map<string, number>();
  const findings: OntologyFinding[] = [];
  let findingCount = 0;
  const bump = (counts: Map<string, number>, name: string) =>
    counts.set(name, (counts.get(name) ?? 0) + 1);

  for (const page of pages) {
    const add = (parting: OntologyParting) => {
      findingCount++;
      if ('name' in parting && parting.kind.startsWith('relation-'))
        bump(relationFindings, parting.name);
      if (findings.length < findingLimit)
        findings.push({ path: page.path, title: page.title, ...parting });
    };
    if (page.unreadable) {
      add({ kind: 'unreadable' });
      continue;
    }
    const type = page.type?.trim() || undefined;
    if (!type) add({ kind: 'type-missing' });
    else {
      bump(typePages, type);
      if (!own(declaration.types, type))
        add({ kind: 'type-undeclared', name: type, use: avoid.get(type) });
    }
    for (const key of requiredKeys(declaration, type))
      if (key !== 'type' && !page.keys.includes(key)) add({ kind: 'key-missing', name: key });

    const stated = new Set<string>();
    for (const { rel, target } of page.relations) {
      if (!rel || !target) {
        add({ kind: 'relation-incomplete' });
        continue;
      }
      bump(relationUses, rel);
      if (!own(declaration.relations, rel)) {
        add({ kind: 'relation-undeclared', name: rel, use: avoid.get(rel) });
        continue;
      }
      const entry = declaration.relations[rel];
      const once = `${rel}\0${target}`;
      if (stated.has(once)) add({ kind: 'relation-repeated', name: rel, target });
      stated.add(once);
      if (type && entry.from && entry.from !== 'any' && !entry.from.includes(type))
        add({ kind: 'relation-from', name: rel, type });
      const link = resolveNoteLink(page.path, target);
      const to = relationTarget(entry.to);
      if (to === 'url') {
        if (link.kind !== 'external') add({ kind: 'relation-not-url', name: rel, target });
        continue;
      }
      const found = link.kind === 'internal' ? byPath.get(link.path.normalize('NFC')) : undefined;
      if (!found) add({ kind: 'relation-not-page', name: rel, target });
      else if (Array.isArray(to) && !(found.type && to.includes(found.type)))
        add({ kind: 'relation-target-type', name: rel, target, type: found.type });
    }
  }

  const undeclared = (counts: Map<string, number>, declared: object): UndeclaredName[] =>
    [...counts]
      .filter(([name]) => !own(declared, name))
      .map(([name, count]) => ({ name, count, use: avoid.get(name) }))
      .sort((a, b) => b.count - a.count || compareCodePoints(a.name, b.name));
  return {
    types: Object.entries(declaration.types).map(([name, entry]) => ({
      name,
      description: entry.description,
      required: requiredKeys(declaration, name),
      pages: typePages.get(name) ?? 0,
    })),
    relations: Object.entries(declaration.relations).map(([name, entry]) => ({
      name,
      description: entry.description,
      from: entry.from ?? 'any',
      to: relationTarget(entry.to),
      uses: relationUses.get(name) ?? 0,
      findings: relationFindings.get(name) ?? 0,
    })),
    avoid: declaration.avoid.map(({ name, use }) => ({ name, use })),
    pages: pages.length,
    undeclaredTypes: undeclared(typePages, declaration.types),
    undeclaredRelations: undeclared(relationUses, declaration.relations),
    findings,
    findingCount,
  };
}
