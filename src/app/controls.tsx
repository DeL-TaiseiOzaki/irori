import { Button as AstryxButton, type ButtonVariant } from '@astryxdesign/core/Button';
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
