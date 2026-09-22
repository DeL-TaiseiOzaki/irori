import path from 'node:path';
import type { FileService } from './files';
import { classify } from '../domain/scopes';
import type { Document } from '../domain/types';
import { ontologyDeclaration, ontologyGraph, type OntologyView } from '../domain/ontology';
import { graphIndexDeclaration, graphIndexFiles } from '../domain/graph-index';

/** Refuses a path outside this KB's knowledge layer or reached through an alias, without opening it. */
export async function knowledgePath(files: FileService, scopeId: string, relative: string) {
  const space = files.get(scopeId);
  if (classify(space, relative) !== 'Knowledge_Base')
    throw Error('Ontology files and note links must belong to this KB knowledge layer');
  const actual = await files.resolve(scopeId, relative);
  if (path.relative(space.root, actual).split(path.sep).join('/') !== relative)
    throw Error('Ontology files must not be aliases');
}

/** A knowledge-layer file read through the guards above, or undefined when there is none. */
export async function knowledgeFile(
  files: FileService,
  scopeId: string,
  relative: string,
): Promise<Document | undefined> {
  try {
    await knowledgePath(files, scopeId, relative);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  return files.read(scopeId, relative);
}

/** The text of `.irori/ontology.json`, or null when the KB declares nothing. */
export async function readDeclaration(files: FileService, scopeId: string) {
  try {
    return (await files.read(scopeId, '.irori/ontology.json')).text;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * The graph a KB shows: the pair `.irori/ontology.json` declares when there is
 * one, else the graph index the knowledge base carries when
 * `Knowledge_Base/ontology/entities.csv` exists, read with the module's own
 * column mapping and the relation table when present. Both go through the same
 * parser and validations.
 */
export async function readOntology(
  files: FileService,
  scopeId: string,
): Promise<OntologyView | null> {
  const declared = await readDeclaration(files, scopeId);
  let declaration;
  let source: OntologyView['source'];
  let documents: Document[];
  if (declared !== null) {
    declaration = ontologyDeclaration.parse(JSON.parse(declared.replace(/^\uFEFF/, '')));
    source = 'declared';
    const paths = [
      declaration.entities.path,
      ...(declaration.relations ? [declaration.relations.path] : []),
    ];
    documents = await Promise.all(
      paths.map(async (relative) => {
        await knowledgePath(files, scopeId, relative);
        return files.read(scopeId, relative);
      }),
    );
  } else {
    const entities = await knowledgeFile(files, scopeId, graphIndexFiles.entities);
    if (!entities) return null;
    const relations = await knowledgeFile(files, scopeId, graphIndexFiles.relations);
    declaration = graphIndexDeclaration(relations !== undefined);
    source = 'module';
    documents = relations ? [entities, relations] : [entities];
  }
  const graph = ontologyGraph(declaration, documents[0].text, documents[1]?.text);
  // Keep missing notes as links; reject aliases and foreign owners without opening their bytes.
  await Promise.all(
    [...new Set(graph.entities.flatMap((entity) => (entity.note ? [entity.note] : [])))].map(
      async (relative) => {
        try {
          await knowledgePath(files, scopeId, relative);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      },
    ),
  );
  return {
    scopeId,
    source,
    entitiesPath: declaration.entities.path,
    relationsPath: declaration.relations?.path,
    revisions: documents.map(({ path, hash }) => ({ path, hash })),
    ...graph,
  };
}
