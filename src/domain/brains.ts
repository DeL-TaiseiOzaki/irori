import { z } from 'zod';
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

export const brainGlyphs = [
  'book',
  'flask',
  'rocket',
  'landmark',
  'feather',
  'compass',
  'bulb',
  'globe',
  'map',
  'users',
  'user',
  'building',
  'briefcase',
  'code',
  'database',
  'shield',
  'star',
  'heart',
  'leaf',
  'anchor',
  'target',
  'box',
  'music',
  'mountain',
] as const;
export type BrainGlyph = (typeof brainGlyphs)[number];

/** How many characters a reader sees, counting an emoji or a combined letter as one. */
export function graphemes(text: string) {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;
}

/** An image icon lives in the KB's `.irori/`, named by its content. */
export const iconImagePath = /^\.irori\/icon-[a-f0-9]{12}\.(png|jpeg|gif|webp)$/;

/**
 * A brain's look as `.irori/scope.json` carries it, so everyone who opens the KB
 * sees the same tile. Both parts are optional; a missing one is derived.
 */
export const brainLook = z.object({
  icon: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('glyph'), glyph: z.enum(brainGlyphs) }),
      z.object({
        kind: z.literal('text'),
        text: z
          .string()
          .trim()
          .min(1)
          .max(16)
          .refine((value) => graphemes(value) <= 2),
      }),
      z.object({ kind: z.literal('image'), path: z.string().regex(iconImagePath) }),
    ])
    .optional(),
  color: z.enum(brainColors).optional(),
});
export type BrainLook = z.infer<typeof brainLook>;
export type BrainMark = NonNullable<BrainLook['icon']>;
export interface BrainAppearance {
  mark: BrainMark;
  color: BrainColor;
}

export function brainColorName(color: BrainColor) {
  return {
    stone: t('石', 'Stone'),
    ai: t('藍', 'Indigo'),
    koke: t('苔', 'Moss'),
    seiji: t('青磁', 'Celadon'),
    fuji: t('藤', 'Wisteria'),
    sakura: t('桜', 'Sakura'),
    suna: t('砂', 'Sand'),
    shiro: t('白', 'White'),
  }[color];
}

export function categoryName(category?: Category) {
  if (!category) return t('分類なし', 'No category');
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
 * A brain's tile: its chosen icon and colour, or else the initial of its name on
 * a colour derived from its scope ID, so it looks the same everywhere and on
 * every device. White is left for people to choose.
 */
export function brainAppearance(
  space: Pick<Space, 'scopeId' | 'name' | 'appearance'>,
): BrainAppearance {
  let hash = 0;
  for (const character of space.scopeId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return {
    mark: space.appearance?.icon ?? { kind: 'text', text: initial(space.name) },
    color: space.appearance?.color ?? brainColors[hash % (brainColors.length - 1)],
  };
}
