// Adapted from ObsidianUI's Magnet Tabs (MIT). See docs/THIRD_PARTY_NOTICES.md.
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { motion } from 'motion/react';
import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import './magnet-tabs.css';

// Motion's hook snapshots the preference at mount; keep OS changes live as well.
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
function subscribeMotionPreference(notify: () => void) {
  motionPreference.addEventListener('change', notify);
  return () => motionPreference.removeEventListener('change', notify);
}
const readMotionPreference = () => motionPreference.matches;

export function MagnetTabs<T extends string>({
  label,
  value,
  onValueChange,
  options,
  className = '',
}: {
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode; disabled?: boolean }[];
  className?: string;
}) {
  const id = useId();
  const reducedMotion = useSyncExternalStore(subscribeMotionPreference, readMotionPreference);
  const [hovered, setHovered] = useState<T>();
  const highlighted = options.some((option) => option.value === hovered && !option.disabled)
    ? hovered
    : value;

  function indicator(kind: 'marker' | 'highlight') {
    const className = `obsidian-magnet-${kind}`;
    // Static elements avoid shared-layout movement entirely when motion is reduced.
    return reducedMotion ? (
      <span className={className} aria-hidden="true" />
    ) : (
      <motion.span
        aria-hidden="true"
        className={className}
        layout
        layoutId={`${id}-${kind}`}
        transition={{ duration: 0.2, type: 'spring', bounce: kind === 'marker' ? 0.2 : 0 }}
      />
    );
  }

  return (
    <ToggleGroup
      className={`obsidian-magnet-tabs ${className}`}
      aria-label={label}
      value={[value]}
      onValueChange={(next) => {
        const option = options.find((option) => option.value === next[0] && !option.disabled);
        if (option && option.value !== value) onValueChange(option.value);
      }}
      onPointerLeave={() => setHovered(undefined)}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          type="button"
          value={option.value}
          disabled={option.disabled}
          className="obsidian-magnet-tab"
          onPointerLeave={() => setHovered(undefined)}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse' && !option.disabled) setHovered(option.value);
          }}
        >
          {highlighted === option.value && indicator('highlight')}
          {value === option.value && indicator('marker')}
          <span className="obsidian-magnet-label">{option.label}</span>
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
