// Adapted from ObsidianUI's Arrow Fill Button (MIT), refined into a rectilinear IDE action.
// See docs/THIRD_PARTY_NOTICES.md.
import type { ComponentProps } from 'react';
import './arrow-fill-button.css';

// A native button preserves form submission, disabled state and focus restoration.
export function ArrowFillButton({
  children,
  className = '',
  type = 'button',
  ...props
}: Omit<ComponentProps<'button'>, 'children'> & { children: string }) {
  return (
    <button {...props} type={type} className={`obsidian-arrow-fill-btn ${className}`.trim()}>
      <span className="obsidian-arrow-fill-btn__text">{children}</span>
      <svg aria-hidden="true" viewBox="0 0 12 12" className="obsidian-arrow-fill-btn__arrow">
        <path
          d="M2.25 6h7.5M6.75 3l3 3-3 3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
