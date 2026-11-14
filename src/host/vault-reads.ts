import type { HostHandlers } from '../domain/host-requests';
import type { AuthorshipStore } from '../knowledge/authorship';
import type { KnowledgeStore } from '../knowledge/store';
import type { GitService } from '../git/service';
import type { BundleService } from './bundle';
import type { FileService } from './files';
import type { ImageService } from './images';
import type { SearchService } from './search';
import type { WorkFolders } from './work-folders';
import { readViewerBytes } from './files';
import { readNoteComments } from './comments';
import { resolveLink } from './links';
import { readNotesDeclaration } from './notes';
import { readPageProperties } from './properties';
import { referringLinks } from './relink';
import { readSkillReach } from './skills';

/** The services a vault's files are read through, wherever the vault is. */
export interface VaultReadServices {
  files: FileService;
  search: SearchService;
  bundle: BundleService;
  images: ImageService;
  git: GitService;
  knowledge: KnowledgeStore;
  authorship: AuthorshipStore;
  work: WorkFolders;
}

/**
 * What the window reads of a vault without changing it. This device answers
 * these for its own vaults, and a vault host answers the same for the vaults on
 * its SSH host (ADR 061), so both read a vault the same way.
 */
export function vaultReads({
  files,
  search,
  bundle,
  images,
  git,
  knowledge,
  authorship,
  work,
}: VaultReadServices) {
  return {
    entries: (...args) => files.entries(...args),
    read: (...args) => files.read(...args),
    readImage: (...args) => images.read(...args),
    viewerBytes: async (id, rel) => readViewerBytes(await files.resolve(id, rel), rel),
    trashedNotes: (id) => files.trashedNotes(id),
    search: (...args) => search.search(...args),
    backlinks: (...args) => search.backlinks(...args),
    referringLinks: (...args) => referringLinks(files, search, ...args),
    resolveLink: (...args) => resolveLink(files, ...args),
    knowledgeHistory: (id) => {
      files.get(id);
      return knowledge.history(id);
    },
    gitStatus: (id) => git.status(id),
    gitDiff: (...args) => git.diff(...args),
    gitHistory: (...args) => git.history(...args),
    gitCommitDiff: (...args) => git.commitDiff(...args),
    gitConflict: (...args) => git.conflict(...args),
    gitSubmodules: (id) => git.submodules(id),
    ontology: (id) => bundle.ontology(id),
    ontologyPages: (id) => bundle.pages(id),
    skillReach: (id) => readSkillReach(files, id),
    workFolder: (scopeId) => work.folder(scopeId),
    notesDeclaration: (id) => readNotesDeclaration(files, id),
    pageProperties: (id) => readPageProperties(files, git, id),
    noteAuthorship: (id, p, text) => authorship.view({ scopeId: id, path: p }, text),
    noteComments: (id, p) => readNoteComments(files, id, p),
  } satisfies Partial<HostHandlers>;
}
/** The operations `vaultReads` answers. */
export type VaultRead = keyof ReturnType<typeof vaultReads>;
