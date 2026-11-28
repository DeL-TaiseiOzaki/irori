import { Button as AstryxButton, type ButtonVariant } from '@astryxdesign/core/Button';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import type { ComponentPropsWithRef, ReactNode } from 'react';

// irori's controls are Astryx's (ADR 076). These adapters keep irori's habits at the call
// site — `disabled`, a native `title` for the hint (ADR 004), any attribute a Base UI
// trigger hands its button — and give Astryx what it asks for: a name, a variant, a size.
// The window's controls are dense, so the default size is Astryx's small (28 px).

type NativeButton = Omit<ComponentPropsWithRef<'button'>, 'children' | 'disabled' | 'color'>;

interface Shared extends NativeButton {
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
}

/** Astryx types `title` out of its props but passes it to the button, as irori's hint. */
function passed(props: NativeButton) {
  return props as Record<string, unknown>;
}

/**
 * A button with words. `label` is what it says and its name; `children`, when given,
 * is shown instead of the label (a count beside the words, say) and the label stays
 * its name. `icon` goes before the words and `endIcon` after them.
 */
export function Button({
  label,
  icon,
  endIcon,
  children,
  disabled = false,
  variant = 'secondary',
  size = 'sm',
  ...props
}: Shared & { label: string; icon?: ReactNode; endIcon?: ReactNode; children?: ReactNode }) {
  return (
    <AstryxButton
      {...passed(props)}
      label={label}
      icon={icon}
      endContent={endIcon}
      variant={variant}
      size={size}
      isDisabled={disabled}
    >
      {children}
    </AstryxButton>
  );
}

/** A button that shows only an icon. `label` is its name, and its hint unless `title` is given. */
export function IconButton({
  label,
  icon,
  title = label,
  disabled = false,
  variant = 'ghost',
  size = 'sm',
  ...props
}: Shared & { label: string; icon: ReactNode }) {
  return (
    <AstryxButton
      {...passed({ ...props, title })}
      label={label}
      icon={icon}
      isIconOnly
      variant={variant}
      size={size}
      isDisabled={disabled}
    />
  );
}

/**
 * A choice of one view among a few, shown side by side: Astryx's segmented control, a
 * radio group named by `label`. An option's `label` is its name; with `labelHidden` only
 * its icon shows.
 */
export function Segmented<T extends string>({
  label,
  value,
  onValueChange,
  options,
  size = 'sm',
  layout = 'hug',
  className,
}: {
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  options: readonly {
    value: T;
    label: string;
    icon?: ReactNode;
    disabled?: boolean;
    labelHidden?: boolean;
  }[];
  size?: 'sm' | 'md' | 'lg';
  /** `fill` shares the width out among the options. */
  layout?: 'hug' | 'fill';
  className?: string;
}) {
  return (
    <SegmentedControl
      className={className}
      label={label}
      value={value}
      size={size}
      layout={layout}
      onChange={(next) => {
        const option = options.find((option) => option.value === next && !option.disabled);
        if (option && option.value !== value) onValueChange(option.value);
      }}
    >
      {options.map((option) => (
        <SegmentedControlItem
          key={option.value}
          value={option.value}
          label={option.label}
          icon={option.icon}
          isDisabled={option.disabled}
          isLabelHidden={option.labelHidden}
        />
      ))}
    </SegmentedControl>
  );
}
