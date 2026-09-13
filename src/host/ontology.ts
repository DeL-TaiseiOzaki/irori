import path from 'node:path';
import type { FileService } from './files';
import { classify } from '../domain/scopes';
import { ontologyDeclaration, ontologyGraph, type OntologyView } from '../domain/ontology';

export async function readOntology(
  files: FileService,
  scopeId: string,
): Promise<OntologyView | null> {
  let text: string;
  try {
    text = (await files.read(scopeId, '.irori/ontology.json')).text;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const declaration = ontologyDeclaration.parse(JSON.parse(text.replace(/^\uFEFF/, '')));
  const space = files.get(scopeId);
  async function knowledgePath(relative: string) {
    if (classify(space, relative) !== 'Knowledge_Base')
      throw Error('Ontology files and note links must belong to this KB knowledge layer');
    const actual = await files.resolve(scopeId, relative);
    if (path.relative(space.root, actual).split(path.sep).join('/') !== relative)
      throw Error('Ontology files must not be aliases');
  }
  const paths = [
    declaration.entities.path,
    ...(declaration.relations ? [declaration.relations.path] : []),
  ];
  const documents = await Promise.all(
    paths.map(async (relative) => {
      await knowledgePath(relative);
      return files.read(scopeId, relative);
    }),
  );
  const graph = ontologyGraph(declaration, documents[0].text, documents[1]?.text);
  // Keep missing notes as links; reject aliases and foreign owners without opening their bytes.
  await Promise.all(
    [...new Set(graph.entities.flatMap((entity) => (entity.note ? [entity.note] : [])))].map(
      async (relative) => {
        try {
          await knowledgePath(relative);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      },
    ),
  );
  return {
    scopeId,
    entitiesPath: paths[0],
    relationsPath: paths[1],
    revisions: documents.map(({ path, hash }) => ({ path, hash })),
    ...graph,
  };
}
