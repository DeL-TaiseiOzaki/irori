import { z } from 'zod';
import type { Layer } from './types';
import { t } from './i18n';

/** The knowledge folder of a hibachi that declares none (ADR 024). */
export const defaultKnowledgeFolder = 'Knowledge_Base';
/** The contents folder irori declares when it registers a KB. */
export const defaultContentsFolder = 'contents';
/** The layers whose folder and shown name a hibachi may change; Schema keeps both. */
export type NamedLayer = Exclude<Layer, 'schema'>;
const defaultLabels: Record<Layer, string> = {
  schema: 'Schema',
  Knowledge_Base: 'Knowledge',
  contents: 'Contents',
};
/** Top-level names that already mean Schema, or that tools own. */
const reserved = [
  'schema',
  'agents.md',
  'claude.md',
  'opencode.json',
  'opencode.jsonc',
  'node_modules',
];

/** What a hibachi says about its layers in `.irori/scope.json`. */
interface LayerDeclaration {
  contents: string[];
  knowledge?: string;
  labels?: Partial<Record<NamedLayer, string>>;
}

/** The folder where the hibachi's knowledge pages live; everything outside Schema and contents is knowledge too. */
export function knowledgeFolder(space: Pick<LayerDeclaration, 'knowledge'>) {
  return space.knowledge ?? defaultKnowledgeFolder;
}
/** The contents folder irori connects folders into and renames. */
export function contentsFolder(space: Pick<LayerDeclaration, 'contents'>) {
  return space.contents[0];
}
export function layerFolder(space: LayerDeclaration, layer: NamedLayer) {
  return layer === 'contents' ? contentsFolder(space) : knowledgeFolder(space);
}
/** The folders an OKF `sources` path may start from: the knowledge folder and each contents root. */
export function layerRoots(space: LayerDeclaration) {
  return [knowledgeFolder(space), ...space.contents];
}
/** The name a layer is shown under: the hibachi's own, or irori's. */
export function layerLabel(space: Pick<LayerDeclaration, 'labels'> | undefined, layer: Layer) {
  return (layer !== 'schema' && space?.labels?.[layer]) || defaultLabels[layer];
}
export const defaultLayerLabel = (layer: Layer) => defaultLabels[layer];

/** Why `name` cannot be a layer folder at the top of a hibachi, or undefined when it can. */
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
export const layerLabelText = z.string().trim().min(1).max(40);
export const layerLabels = z
  .object({ Knowledge_Base: layerLabelText.optional(), contents: layerLabelText.optional() })
  .strict();

/** A path moved by a layer folder rename: `from/...` becomes `to/...`, anything else stays. */
export function renamedPath(p: string, from: string, to: string) {
  if (p === from) return to;
  return p.startsWith(from + '/') ? to + p.slice(from.length) : undefined;
}
