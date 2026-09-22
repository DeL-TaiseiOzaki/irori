// Adapted from ObsidianUI's Arrow Fill Button (MIT). See docs/THIRD_PARTY_NOTICES.md.
import type { ComponentProps } from 'react';
import './arrow-fill-button.css';

// A native button preserves form submission, disabled state and focus restoration.
// Text only: the decorative duplicate must never contain interactive children or IDs.
export function ArrowFillButton({
  children,
  className = '',
  type = 'button',
  ...props
}: Omit<ComponentProps<'button'>, 'children'> & { children: string }) {
  return (
    <button {...props} type={type} className={`obsidian-arrow-fill-btn ${className}`}>
      <span className="obsidian-arrow-fill-btn__text">{children}</span>
      <span aria-hidden="true" className="obsidian-arrow-fill-btn__circle">
        <span>{children}</span>
        <svg viewBox="0 0 10 10" className="obsidian-arrow-fill-btn__icon">
          {[0, 1].map((key) => (
            <path
              key={key}
              d="M0 5.625h7.625l-3.5 3.5L5 10l5-5-5-5-.875.875 3.5 3.5H0Z"
              className="obsidian-arrow-fill-btn__path"
            />
          ))}
        </svg>
      </span>
    </button>
  );
}
