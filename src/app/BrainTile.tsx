import type { CSSProperties } from 'react';
import { brainAppearance } from '../domain/brains';
import type { Space } from '../domain/types';

/**
 * A brain's mark on its own colour. `ring` follows the surface: a hairline on
 * the chrome or the stage, and a ring with a gap for the brain being shown.
 */
export function BrainTile({
  space,
  size = 40,
  radius = Math.round(size * 0.3),
  ring = 'panel',
  className = '',
}: {
  space: Pick<Space, 'scopeId' | 'name'>;
  size?: number;
  radius?: number;
  ring?: 'panel' | 'active' | 'stage';
  className?: string;
}) {
  const { mark, color } = brainAppearance(space);
  const style = {
    width: size,
    height: size,
    borderRadius: radius,
    fontSize: Math.round(size * 0.42),
    background: `var(--t-${color})`,
    color: `var(--t-${color}-fg)`,
  } satisfies CSSProperties;
  return (
    <span className={`brain-tile ring-${ring} ${className}`} style={style} aria-hidden="true">
      {mark.text}
    </span>
  );
}
