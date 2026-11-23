import { z } from 'zod';
import type { Layer } from './types';
import { t } from './i18n';

/** The knowledge folder of a vault that declares none (ADR 024). */
export const defaultKnowledgeFolder = 'Knowledge_Base';
/** How `.irori/scope.json` names the vault's root as its knowledge folder (ADR 035). */
export const rootKnowledgeFolder = '.';
/** The contents folder irori declares when it registers a KB. */
export const defaultContentsFolder = 'contents';
/**
 * The layers whose folder and shown name a vault may change, and which a vault
 * may leave out (ADR 070); Schema keeps its name and places, and every vault has it.
 */
export type NamedLayer = Exclude<Layer, 'schema'>;
export const namedLayers: readonly NamedLayer[] = ['Knowledge_Base', 'contents'];
const defaultLabels: Record<Layer, string> = {
  schema: 'Schema',
  Knowledge_Base: 'Knowledge',
  contents: 'Contents',
};
/** The files at the top of a vault that belong to Schema: its agents' instructions and settings. */
export const schemaFiles = ['AGENTS.md', 'CLAUDE.md', 'opencode.json', 'opencode.jsonc'];
/**
 * The repository's front page at the top of a vault is Schema too (ADR 028):
 * it introduces the checkout, it is not a knowledge page. Matched in any case,
 * as GitHub finds `readme.md` or `Readme.md` and a default Mac or Windows volume
 * reaches the same file through either spelling. A nested README stays knowledge.
 */
export const isRootReadme = (relative: string) => /^readme\.md$/i.test(relative);
/**
 * Whether a vault path is Schema: a hidden top-level entry, `schema/`, an
 * agent's instructions at the top or the repository's front page.
 */
export function isSchemaPath(relative: string) {
  const top = relative.split('/')[0];
  return (
    top.startsWith('.') ||
    top === 'schema' ||
    schemaFiles.includes(relative) ||
    isRootReadme(relative)
  );
}
/** Top-level names that already mean Schema, or that tools own. */
const reserved = [
  'schema',
  ...schemaFiles.map((name) => name.toLowerCase()),
  'readme.md',
  'node_modules',
];

/** What a vault says about its layers in `.irori/scope.json`. */
interface LayerDeclaration {
  contents: string[];
  knowledge?: string;
  labels?: Partial<Record<NamedLayer, string>>;
  layers?: readonly NamedLayer[];
}

/**
 * Whether the vault has the layer (ADR 070). A vault that declares no `layers`
 * has all three, as every vault did before; Schema is never left out.
 */
export function hasLayer(space: Pick<LayerDeclaration, 'layers'> | undefined, layer: Layer) {
  return layer === 'schema' || !space?.layers || space.layers.includes(layer);
}
/** The Knowledge and Contents layers the vault has, in irori's order. */
export const vaultLayers = (space: Pick<LayerDeclaration, 'layers'> | undefined) =>
  namedLayers.filter((layer) => hasLayer(space, layer));
/**
 * `layers` as `.irori/scope.json` keeps it: in irori's order without repeats,
 * and absent when the vault has both, so an unchanged vault's file stays as it was.
 */
export function declaredLayers(layers: readonly NamedLayer[] | null | undefined) {
  const chosen = namedLayers.filter((layer) => layers?.includes(layer));
  return !layers || chosen.length === namedLayers.length ? undefined : chosen;
}
/** The vault has no such layer: what a request that needs it is refused with. */
export const noLayer = (space: Pick<LayerDeclaration, 'labels'> & { name: string }, layer: Layer) =>
  Error(
    t(
      `vault「${space.name}」には ${layerLabel(space, layer)} 層がありません。vault の設定の「層」で選べます。`,
      `The vault "${space.name}" has no ${layerLabel(space, layer)} layer. Its settings choose its layers.`,
    ),
  );

/**
 * The folder where the vault's knowledge pages live; everything outside Schema
 * and contents is knowledge too. `''` is the vault's root (ADR 035).
 */
export function knowledgeFolder(space: Pick<LayerDeclaration, 'knowledge'>) {
  const folder = space.knowledge ?? defaultKnowledgeFolder;
  return folder === rootKnowledgeFolder ? '' : folder;
}
/** A layer folder as a person reads and types it: the vault's root is `.`. */
export const shownFolder = (folder: string) => folder || rootKnowledgeFolder;
/** `relative` inside `folder`, where `''` is the vault's root. */
export const inFolder = (folder: string, relative: string) =>
  folder ? `${folder}/${relative}` : relative;
/** Whether `p` is `folder` or lies below it; every path lies below the vault's root `''`. */
export const underFolder = (folder: string, p: string) =>
  !folder || p === folder || p.startsWith(`${folder}/`);
/** The contents folder irori connects folders into and renames. */
export function contentsFolder(space: Pick<LayerDeclaration, 'contents'>) {
  return space.contents[0];
}
export function layerFolder(space: LayerDeclaration, layer: NamedLayer) {
  return layer === 'contents' ? contentsFolder(space) : knowledgeFolder(space);
}
/**
 * The folders an OKF `sources` path may start from: the knowledge folder and
 * each contents root. A knowledge folder at the vault's root is none: a path
 * into it is relative to its page.
 */
export function layerRoots(space: LayerDeclaration) {
  return [knowledgeFolder(space), ...space.contents].filter(Boolean);
}
/** The name a layer is shown under: the vault's own, or irori's. */
export function layerLabel(space: Pick<LayerDeclaration, 'labels'> | undefined, layer: Layer) {
  return (layer !== 'schema' && space?.labels?.[layer]) || defaultLabels[layer];
}
export const defaultLayerLabel = (layer: Layer) => defaultLabels[layer];

/** Why `name` cannot be a layer folder at the top of a vault, or undefined when it can. */
export function layerFolderProblem(name: string): string | undefined {
  if (!name || name.length > 64 || /[\u0000-\u001f/\\:*?"<>|]/.test(name))
    return t(
      'フォルダ名には 64 文字以内で、/ \\ : * ? " < > | を含まない名前を使ってください。',
      'Use a folder name of up to 64 characters without / \\ : * ? " < > |.',
    );
  if (name.startsWith('.') || /[. ]$/.test(name) || name !== name.trim())
    return t(
      'フォルダ名の先頭に . を、前後に空白を、末尾に . を使えません。',
      'A folder name cannot start with a dot, end with a dot, or start or end with a space.',
    );
  if (reserved.includes(name.toLowerCase()))
    return t(
      `「${name}」は Schema やツールが使う名前です。`,
      `"${name}" is a name Schema or a tool uses.`,
    );
}
export const layerFolderName = z.string().refine((name) => !layerFolderProblem(name));
/** A knowledge folder may also be the vault's root, written `.` (ADR 035). */
export const knowledgeFolderName = z.union([z.literal(rootKnowledgeFolder), layerFolderName]);
const labelLength = 40;
const perNamedLayer = <T extends z.ZodType>(label: T) =>
  z.object({ Knowledge_Base: label, contents: label }).strict();
/** The Knowledge and Contents layers a vault has; an empty list is a vault of Schema alone. */
export const layerSelection = z.array(z.enum(['Knowledge_Base', 'contents'])).max(2);
export const layerLabelText = z.string().trim().min(1).max(labelLength);
export const layerLabels = perNamedLayer(layerLabelText.optional());
/** A change to the shown names: an empty or `null` one returns to irori's. */
export const layerLabelChanges = perNamedLayer(z.string().max(labelLength).nullable().optional());

/** A path moved by a layer folder rename: `from/...` becomes `to/...`, anything else stays. */
export function renamedPath(p: string, from: string, to: string) {
  if (p === from) return to;
  return p.startsWith(from + '/') ? inFolder(to, p.slice(from.length + 1)) : undefined;
}

/**
 * What a change of layer folder moved. Between two named folders, `from/...`
 * became `to/...`. When either is the vault's root (`''`), only the entries
 * named in `entries` moved, by their names at the root: the knowledge folder's
 * children, or the top-level knowledge entries (ADR 035).
 */
export interface LayerMove {
  from: string;
  to: string;
  entries?: readonly string[];
}
/** Where `p` is after `move`, or undefined when the move left it in place. */
export function movedPath(move: LayerMove, p: string): string | undefined {
  if (move.from) return renamedPath(p, move.from, move.to);
  const top = p.split('/')[0].normalize('NFC');
  return move.entries?.some((entry) => entry.normalize('NFC') === top)
    ? inFolder(move.to, p)
    : undefined;
}
/** The same move undone: where a path that moved came from. */
export const reversedMove = (move: LayerMove): LayerMove => ({
  ...move,
  from: move.to,
  to: move.from,
});
