import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '../domain/i18n';
import { Icon } from './Icon';

/**
 * A brain's view that takes the stage in place of the note — the graph, or the
 * materials and outputs. Like a dialog it takes focus, closes on Escape and
 * returns focus to what opened it; unlike one, the rest of the window stays usable.
 */
export function StageView({
  label,
  crumbs,
  actions,
  busy = false,
  className = '',
  onClose,
  children,
}: {
  label: string;
  crumbs: ReactNode;
  actions?: ReactNode;
  busy?: boolean;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <section
      ref={ref}
      className={`stage-view ${className}`}
      role="region"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || busy || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className="stage-bar">
        {crumbs}
        <div className="stage-actions">
          {actions}
          <button
            className="stage-button"
            aria-label={t('閉じる', 'Close')}
            title={t('閉じる', 'Close')}
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </header>
      <div className="stage-view-body">{children}</div>
    </section>
  );
}
