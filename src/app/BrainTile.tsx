import { useEffect, useState, type CSSProperties } from 'react';
import {
  Anchor,
  BookOpen,
  Box,
  Briefcase,
  Building2,
  Code,
  Compass,
  Database,
  Feather,
  FlaskConical,
  Globe,
  Heart,
  Landmark,
  Leaf,
  Lightbulb,
  Map,
  Mountain,
  Music,
  Rocket,
  Shield,
  Star,
  Target,
  User,
  Users,
} from 'lucide-react';
import { brainAppearance, graphemes, type BrainGlyph } from '../domain/brains';
import type { Space } from '../domain/types';

export const glyphs: Record<BrainGlyph, typeof BookOpen> = {
  book: BookOpen,
  flask: FlaskConical,
  rocket: Rocket,
  landmark: Landmark,
  feather: Feather,
  compass: Compass,
  bulb: Lightbulb,
  globe: Globe,
  map: Map,
  users: Users,
  user: User,
  building: Building2,
  briefcase: Briefcase,
  code: Code,
  database: Database,
  shield: Shield,
  star: Star,
  heart: Heart,
  leaf: Leaf,
  anchor: Anchor,
  target: Target,
  box: Box,
  music: Music,
  mountain: Mountain,
};

// An icon image is named by its content, so what was read once stays right.
const images = new globalThis.Map<string, Promise<string>>();
function useIconImage(scopeId: string, path?: string) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!path) return setUrl(undefined);
    const key = `${scopeId}:${path}`;
    if (!images.has(key))
      images.set(
        key,
        window.irori.readImage(scopeId, '.irori/scope.json', path.slice('.irori/'.length)),
      );
    let live = true;
    images
      .get(key)!
      .then((value) => live && setUrl(value))
      .catch(() => {
        images.delete(key);
        if (live) setUrl(undefined);
      });
    return () => {
      live = false;
    };
  }, [scopeId, path]);
  return url;
}

/**
 * A brain's mark on its own colour: a symbol, one or two characters, or an
 * image. `ring` follows the surface: a hairline on the chrome or the stage, and
 * a ring with a gap for the brain being shown. `image` previews a picked file.
 */
export function BrainTile({
  space,
  size = 40,
  radius = Math.round(size * 0.3),
  ring = 'panel',
  image,
  className = '',
}: {
  space: Pick<Space, 'scopeId' | 'name' | 'appearance'>;
  size?: number;
  radius?: number;
  ring?: 'panel' | 'active' | 'stage';
  image?: string;
  className?: string;
}) {
  const { mark, color } = brainAppearance(space);
  const stored = useIconImage(space.scopeId, mark.kind === 'image' ? mark.path : undefined);
  const style = {
    width: size,
    height: size,
    borderRadius: radius,
    fontSize: Math.round(size * (mark.kind === 'text' && graphemes(mark.text) > 1 ? 0.34 : 0.42)),
    background: `var(--t-${color})`,
    color: `var(--t-${color}-fg)`,
  } satisfies CSSProperties;
  const Glyph = mark.kind === 'glyph' ? glyphs[mark.glyph] : undefined;
  return (
    <span className={`brain-tile ring-${ring} ${className}`} style={style} aria-hidden="true">
      {image ? (
        <img src={image} alt="" style={{ borderRadius: radius }} />
      ) : Glyph ? (
        <Glyph
          width={Math.max(10, Math.round(size * 0.5))}
          height={Math.max(10, Math.round(size * 0.5))}
          strokeWidth={size <= 20 ? 2.3 : size <= 32 ? 2 : 1.8}
        />
      ) : mark.kind === 'image' ? (
        stored && <img src={stored} alt="" style={{ borderRadius: radius }} />
      ) : (
        mark.kind === 'text' && mark.text
      )}
    </span>
  );
}
