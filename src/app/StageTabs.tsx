import { baseName } from '../domain/paths';
import { t } from '../domain/i18n';
import { Icon } from './Icon';

/**
 * A stage column's open files (ADR 052), in the agent columns' tab style. The
 * tab on show in the focused column is the file being edited.
 */
export function StageTabs({
  tabs,
  on,
  focused,
  disabled,
  onShow,
  onClose,
  onCloseColumn,
}: {
  tabs: string[];
  on?: string;
  focused: boolean;
  disabled: boolean;
  onShow: (path: string) => void;
  onClose: (path: string) => void;
  /** Closes the column; absent for the stage's only column. */
  onCloseColumn?: () => void;
}) {
  return (
    <div className={`stage-tabs${focused ? ' focused' : ''}`}>
      <div
        className="stage-tab-list"
        role="tablist"
        aria-label={t('開いているファイル', 'Open files')}
      >
        {tabs.map((path) => {
          const name = baseName(path);
          const current = path === on;
          return (
            <div key={path} className={`stage-tab${current ? ' current' : ''}`}>
              <button
                role="tab"
                aria-selected={current}
                title={path}
                disabled={disabled}
                onClick={() => onShow(path)}
              >
                <span>{name}</span>
              </button>
              <button
                className="stage-tab-close"
                aria-label={t(`${name} のタブを閉じる`, `Close the ${name} tab`)}
                disabled={disabled}
                onClick={() => onClose(path)}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          );
        })}
      </div>
      {onCloseColumn && (
        <button
          className="icon-button stage-column-close"
          aria-label={t('この列を閉じる', 'Close this column')}
          title={t('この列を閉じる', 'Close this column')}
          disabled={disabled}
          onClick={onCloseColumn}
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
