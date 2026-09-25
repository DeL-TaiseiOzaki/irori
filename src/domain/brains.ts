import { t } from './i18n';
import type { Category, Space } from './types';

/**
 * A brain is one registered KB shown with its Schema, Knowledge and Contents
 * together (ADR 014). Its tile carries a mark and one of eight calm colours;
 * orange is left out because it belongs to the AI.
 */
export const brainColors = [
  'stone',
  'ai',
  'koke',
  'seiji',
  'fuji',
  'sakura',
  'suna',
  'shiro',
] as const;
export type BrainColor = (typeof brainColors)[number];

export interface BrainAppearance {
  mark: { kind: 'text'; text: string };
  color: BrainColor;
}

export function categoryName(category: Category) {
  return {
    personal: t('個人', 'Personal'),
    team: t('チーム', 'Team'),
    organization: t('組織', 'Organization'),
  }[category];
}

/** The first character a reader would pick out of the name, capitalised when it has case. */
function initial(name: string) {
  const first =
    [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name.trim())][0]
      ?.segment ?? '?';
  return first.toLocaleUpperCase();
}

/**
 * Until a brain's own appearance can be chosen, each gets the initial of its
 * name on a colour derived from its scope ID, so it looks the same everywhere
 * and on every device. White is left for people to choose.
 */
export function brainAppearance(space: Pick<Space, 'scopeId' | 'name'>): BrainAppearance {
  let hash = 0;
  for (const character of space.scopeId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return {
    mark: { kind: 'text', text: initial(space.name) },
    color: brainColors[hash % (brainColors.length - 1)],
  };
}
