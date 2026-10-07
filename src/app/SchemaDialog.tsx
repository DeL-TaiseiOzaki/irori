import { useState, type ReactNode } from 'react';
import type { Space } from '../domain/types';
import { sharedSchemaId, type YourAi } from '../domain/you';
import { t } from '../domain/i18n';
import { BrainTile } from './BrainTile';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { SchemaEditor, SchemaList, type SchemaTarget } from './SchemaSettings';
import './schema-dialog.css';

/**
 * Every Schema from the settings (ADR 027): the shared one every agent follows,
 * the irori agent's and each hibachi's, edited with the same forms as in their
 * own views. irori writes the files behind them, as `.obsidian` holds a vault's.
 */
export function SchemaDialog({
  you,
  spaces,
  revision,
  locked,
  onClose,
}: {
  /** The irori agent; the shared Schema lives in its folder, so both need it set up. */
  you?: YourAi;
  /** The workspace's hibachis whose Schema is offered (none while hibachi agents are off). */
  spaces: Space[];
  revision: number;
  /** Whether a run, a Git operation or a connection holds that Schema's folder. */
  locked: (scopeId: string) => boolean;
  onClose: () => void;
}) {
  const ready = you?.state === 'ready';
  const [owner, setOwner] = useState(() => (ready ? sharedSchemaId : spaces[0]?.scopeId));
  const [target, setTarget] = useState<SchemaTarget>();
  const space = spaces.find((item) => item.scopeId === owner);
  const common = owner === sharedSchemaId;
  const label = t('Schema の設定', 'Schema settings');
  const choose = (next: string) => {
    setOwner(next);
    setTarget(undefined);
  };
  const row = (id: string, name: string, icon: ReactNode) => (
    <button
      key={id}
      className="schema-owner"
      aria-pressed={owner === id}
      onClick={() => choose(id)}
    >
      {icon}
      <span>{name}</span>
    </button>
  );
  return (
    <Dialog label={label} onClose={onClose} className="modal-dialog schema-dialog">
      <div className="schema-dialog-body">
        <nav className="schema-owners" aria-label={label}>
          <header>
            <h2>Schema</h2>
            <button
              className="icon-button"
              aria-label={t('閉じる', 'Close')}
              title={t('閉じる', 'Close')}
              onClick={onClose}
            >
              <Icon name="close" size={16} />
            </button>
          </header>
          {ready && (
            <>
              {row(
                sharedSchemaId,
                t('共通', 'Shared'),
                <Icon name="users" size={16} className="schema-owner-icon" />,
              )}
              {row(
                you.id,
                'irori agent',
                <Icon name="sparkles" size={16} className="schema-owner-icon" />,
              )}
            </>
          )}
          {spaces.map((item) =>
            row(item.scopeId, item.name, <BrainTile space={item} size={20} radius={6} />),
          )}
        </nav>
        {owner ? (
          <div className="schema-dialog-list">
            <SchemaList
              key={owner}
              scopeId={owner}
              space={space}
              common={common}
              revision={revision}
              selected={target}
              locked={locked(owner)}
              onSelect={setTarget}
              onOpenFile={() => undefined}
            />
          </div>
        ) : (
          <p className="schema-dialog-empty">
            {t('irori agent を用意してください。', 'Set up the irori agent first.')}
          </p>
        )}
        <div className="schema-dialog-stage">
          {owner && target && (
            <SchemaEditor
              key={owner}
              scopeId={owner}
              space={space}
              common={common}
              target={target}
              locked={locked(owner)}
              revision={revision}
              onSelect={setTarget}
              onClose={() => setTarget(undefined)}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}
