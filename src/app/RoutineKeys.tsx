import { useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../domain/i18n';
import { secretName, unavailableText, type Routine, type SecretList } from '../domain/routines';
import { Dialog } from './Dialog';
import { errorText } from './ErrorMessage';
import { Icon } from './Icon';

// The routines' secrets (ADR 016 D5). The file name avoids the word, which the
// workspace's agent settings keep from being read.

const host = window.irori;

/** A name as a secret takes it: an environment variable's, in capitals. */
export const secretInput = (value: string) => value.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
export const validSecretName = (value: string) => secretName.safeParse(value).success;

/**
 * Takes a secret's value, and its name when none is given; the value goes to
 * the host and is never shown again.
 */
export function SecretDialog({
  name: given,
  onClose,
  onSaved,
}: {
  name?: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(given ?? '');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = given
    ? t(`シークレット ${given}`, `Secret ${given}`)
    : t('シークレットを追加', 'Add a secret');
  return createPortal(
    <Dialog label={label} busy={busy} onClose={onClose}>
      <form
        className="modal routine-secret-form"
        aria-label={label}
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          host
            .setSecret(name, value.trim())
            .then(() => {
              onSaved(name);
              onClose();
            })
            .catch((reason) => {
              setError(errorText(reason));
              setBusy(false);
            });
        }}
      >
        {given ? <h2 className="mono">{given}</h2> : <h2>{label}</h2>}
        {!given && (
          <label>
            {t('名前', 'Name')}
            <input
              className="mono"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              maxLength={64}
              placeholder="GH_TOKEN"
              value={name}
              disabled={busy}
              onChange={(event) => setName(secretInput(event.target.value))}
            />
          </label>
        )}
        <label>
          {t('値', 'Value')}
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoFocus={!!given}
            value={value}
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        {error && (
          <p className="routine-problem" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {t('キャンセル', 'Cancel')}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || value.trim().length < 8 || !validSecretName(name)}
          >
            {t('保存', 'Save')}
          </button>
        </div>
      </form>
    </Dialog>,
    document.body,
  );
}

/** The secrets a routine's `run` steps name, or that it still needs. */
function namedBy(routine: Routine) {
  return new Set([
    ...routine.steps.flatMap((step) => (step.kind === 'run' && step.secrets) || []),
    ...(routine.needs?.secrets ?? []),
  ]);
}

/**
 * The device's secrets by name with the routines that use them, the ones
 * routines still need, and a new one; values are never shown.
 */
export function SecretsDialog({
  list,
  routines,
  onEnter,
  onChanged,
  onClose,
}: {
  list?: SecretList;
  routines: Routine[];
  /** A value to enter: for a name, or a new secret with its name. */
  onEnter: (name?: string) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [removing, setRemoving] = useState<string>();
  const [error, setError] = useState('');
  const stored = list?.names ?? [];
  const needed = [...new Set(routines.flatMap((routine) => routine.needs?.secrets ?? []))].filter(
    (name) => !stored.includes(name),
  );
  const users = (name: string) =>
    routines.filter((routine) => namedBy(routine).has(name)).map((routine) => routine.name);
  const available = list?.available ?? false;
  const label = t('シークレット', 'Secrets');
  return createPortal(
    <Dialog label={label} onClose={onClose}>
      <div className="modal routine-secrets">
        <h2>{label}</h2>
        {list && !available && <p className="routine-problem">{unavailableText()}</p>}
        {error && (
          <p className="routine-problem" role="alert">
            {error}
          </p>
        )}
        {!!(stored.length || needed.length) && (
          <ul>
            {[...stored, ...needed].map((name) => {
              const kept = stored.includes(name);
              const used = users(name);
              return (
                <li key={name} aria-label={name} className={kept ? undefined : 'missing'}>
                  <Icon name="lock" size={13} />
                  <span className="routine-secret-name">
                    <span className="mono">{name}</span>
                    {!!used.length && <small>{used.join(', ')}</small>}
                  </span>
                  {!kept ? (
                    <button
                      className="panel-button"
                      disabled={!available}
                      onClick={() => onEnter(name)}
                    >
                      {t('入力', 'Enter')}
                    </button>
                  ) : (
                    <>
                      {available && (
                        <button className="panel-button" onClick={() => onEnter(name)}>
                          {t('置き換え', 'Replace')}
                        </button>
                      )}
                      <button
                        className="panel-button"
                        onClick={() => {
                          if (removing !== name) return setRemoving(name);
                          setError('');
                          host
                            .deleteSecret(name)
                            .then(onChanged)
                            .catch((reason) => setError(errorText(reason)))
                            .finally(() => setRemoving(undefined));
                        }}
                        onBlur={() => setRemoving((value) => (value === name ? undefined : value))}
                      >
                        <Icon name="trash" size={13} />
                        {removing === name ? t('削除する', 'Delete it') : t('削除', 'Delete')}
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="actions">
          <button className="panel-button" disabled={!available} onClick={() => onEnter()}>
            <Icon name="plus" size={13} />
            {t('追加', 'Add')}
          </button>
          <span className="routine-space" />
          <button onClick={onClose}>{t('閉じる', 'Close')}</button>
        </div>
      </div>
    </Dialog>,
    document.body,
  );
}
