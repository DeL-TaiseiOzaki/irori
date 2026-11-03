import type { ReactNode } from 'react';
import { t } from '../domain/i18n';
import { Icon } from './Icon';
import { useLanguage } from './useLanguage';

const host = window.irori;
/** macOS keeps irori's menu in its menu bar; elsewhere the window has none (ADR 054). */
const menuInWindow = !/Mac/i.test(navigator.platform || navigator.userAgent);

/**
 * The window's top, drawn by irori (ADR 054): the handle that moves the window, irori's
 * menu on Windows and Linux, and the workspace tabs. The system's window controls are laid
 * over its far end (its start on macOS), in the chrome's colours.
 */
export function TitleBar({
  children,
  onError,
}: {
  children?: ReactNode;
  onError: (error: unknown) => void;
}) {
  useLanguage();
  return (
    <header className="titlebar chrome">
      {menuInWindow && (
        <div className="titlebar-start">
          <button
            className="titlebar-menu"
            title={t('メニュー', 'Menu')}
            aria-label={t('メニュー', 'Menu')}
            aria-haspopup="menu"
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              void host
                .showMenu(
                  Math.max(0, Math.round(box.left)),
                  Math.max(0, Math.round(box.bottom + 4)),
                )
                .catch(onError);
            }}
          >
            <Icon name="menu" size={16} />
          </button>
        </div>
      )}
      {children}
    </header>
  );
}
