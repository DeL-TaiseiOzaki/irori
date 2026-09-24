import { useEffect, useRef, useState } from 'react';
import type { KnowledgeSearch, SearchHit } from '../domain/search';
import type { Space } from '../domain/types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { t } from '../domain/i18n';

const host = window.irori;

export function SearchPanel({
  spaces,
  initialScopeId,
  beforeSearch,
  onOpen,
  onClose,
}: {
  spaces: Space[];
  initialScopeId?: string;
  beforeSearch: () => Promise<boolean>;
  onOpen: (scopeId: string, hit: SearchHit, query: string) => Promise<void>;
  onClose: () => void;
}) {
  const [scopeId, setScopeId] = useState(
    spaces.find((space) => space.scopeId === initialScopeId)?.scopeId ?? spaces[0]?.scopeId ?? '',
  );
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<KnowledgeSearch>();
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const queryInput = useRef<HTMLInputElement>(null);
  const member = spaces.some((space) => space.scopeId === scopeId);

  useEffect(() => {
    // Dialog's child effect opens the native modal before this parent effect.
    queryInput.current?.focus();
  }, []);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  useEffect(
    () =>
      host.onEvent((event) => {
        if (event.type === 'files' && event.scopeId === scopeId) setChanged(true);
      }),
    [scopeId],
  );

  function invalidate() {
    request.current++;
    setSearching(false);
    setResult(undefined);
    setError('');
    setChanged(false);
  }

  async function search() {
    if (!member || !query.trim() || searching || opening) return;
    const id = ++request.current;
    setSearching(true);
    setResult(undefined);
    setError('');
    setChanged(false);
    try {
      const saved = await beforeSearch();
      if (request.current !== id) return;
      if (!saved)
        throw Error(
          t(
            '編集中のノートを保存できませんでした。閉じて、保存や競合の状態を確認してください。',
            'Could not save the note you were editing. Close this and check its save or conflict state.',
          ),
        );
      const value = await host.search(scopeId, query);
      if (request.current === id) setResult(value);
    } catch (error) {
      if (request.current === id) setError(String(error));
    } finally {
      if (request.current === id) setSearching(false);
    }
  }

  async function open(hit: SearchHit) {
    if (!result || !member || opening) return;
    setOpening(true);
    setError('');
    try {
      await onOpen(result.scopeId, hit, result.query);
    } catch (error) {
      setError(String(error));
    } finally {
      setOpening(false);
    }
  }

  return (
    <Dialog
      label={t('KB内を検索', 'Search in KB')}
      className="modal-dialog search-dialog"
      busy={opening}
      onClose={onClose}
    >
      <div className="search-heading">
        <h2>
          <Icon name="search" size={20} /> {t('KB内を検索', 'Search in KB')}
        </h2>
        <button onClick={onClose} disabled={opening}>
          {t('閉じる', 'Close')}
        </button>
      </div>
      <p className="muted" id="search-scope-help">
        {t(
          '選んだローカル KB の本文を検索します。スキーマ・contents・Drive は対象外です。',
          'Searches the body text of the selected local KB. Schema, contents, and Drive are not included.',
        )}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label>
          {t('検索する KB', 'KB to search')}
          <select
            aria-label={t('検索する KB', 'KB to search')}
            aria-describedby="search-scope-help"
            value={scopeId}
            disabled={opening}
            onChange={(event) => {
              invalidate();
              setScopeId(event.target.value);
            }}
          >
            {spaces.map((space) => (
              <option key={space.scopeId} value={space.scopeId}>
                {space.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('本文を検索', 'Search body text')}
          <input
            ref={queryInput}
            type="search"
            aria-label={t('本文を検索', 'Search body text')}
            aria-describedby="search-query-help"
            maxLength={200}
            value={query}
            disabled={opening}
            placeholder={t('ノート本文の言葉を入力', 'Enter words from the note body')}
            onChange={(event) => {
              invalidate();
              setQuery(event.target.value);
            }}
          />
        </label>
        <div className="search-submit">
          <p className="muted" id="search-query-help">
            {t(
              '文字列として検索します。英字の大文字・小文字は区別しません（最大 200 文字）。',
              'Searches as a literal string, case-insensitive for ASCII letters (up to 200 characters).',
            )}
          </p>
          <button
            className="primary"
            type="submit"
            disabled={!member || !query.trim() || searching || opening}
          >
            {searching ? t('検索中…', 'Searching…') : t('検索', 'Search')}
          </button>
        </div>
      </form>
      {error && (
        <p className="search-error" role="alert">
          {error}
        </p>
      )}
      <div role="status" aria-live="polite">
        {searching && <p>{t('本文を検索しています…', 'Searching body text…')}</p>}
        {result && (
          <p>
            {t(`${result.hits.length} 件の一致`, `${result.hits.length} matches`)} ·{' '}
            {t(`${result.scannedFiles} ファイルを検索`, `${result.scannedFiles} files searched`)}
          </p>
        )}
      </div>
      {result && (
        <section aria-label={t('本文の検索結果', 'Body text search results')}>
          {(result.incomplete || result.skippedFiles > 0) && (
            <p className="search-notice">
              {result.incomplete &&
                t(
                  '検索できた範囲の結果です。上限または読めないファイルにより、すべての本文を確認できていません。',
                  'These are the results within what could be searched. A limit or unreadable files meant not every note could be checked.',
                )}
              {result.skippedFiles > 0 &&
                ' ' +
                  t(
                    `${result.skippedFiles} ファイルをスキップしました。`,
                    `Skipped ${result.skippedFiles} files.`,
                  )}{' '}
              {t(
                '必要に応じて検索語を絞って再検索してください。',
                'Narrow the search term and search again if needed.',
              )}
            </p>
          )}
          {changed && (
            <p className="search-notice">
              {t(
                'KB のファイルが更新されました。最新の内容を確認するには再検索してください。',
                'Files in the KB have changed. Search again to see the latest content.',
              )}
            </p>
          )}
          {!result.hits.length && (
            <p>
              {result.incomplete
                ? t(
                    '検索できた範囲に一致する本文はありません。',
                    'No matching body text within what could be searched.',
                  )
                : t('一致する本文はありません。', 'No matching body text.')}
            </p>
          )}
          <Hits hits={result.hits} disabled={opening || !member} onOpen={open} />
        </section>
      )}
    </Dialog>
  );
}

function Hits({
  hits,
  disabled,
  onOpen,
}: {
  hits: SearchHit[];
  disabled: boolean;
  onOpen: (hit: SearchHit) => Promise<void>;
}) {
  return (
    <ul className="search-results">
      {hits.map((hit) => (
        <li key={`${hit.path}:${hit.line}`}>
          <button disabled={disabled} onClick={() => void onOpen(hit)}>
            <span className="search-result-location">
              <Icon name="file" />
              <strong>{hit.path}</strong>
              <small>{t(`${hit.line} 行目`, `Line ${hit.line}`)}</small>
            </span>
            <span className="search-result-preview">{hit.preview}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The notes in one KB whose links lead to the note being read. */
export function BacklinksPanel({
  scopeId,
  path,
  onOpen,
  onClose,
}: {
  scopeId: string;
  path: string;
  onOpen: (hit: SearchHit) => Promise<void>;
  onClose: () => void;
}) {
  const [result, setResult] = useState<KnowledgeSearch>();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const finding = !result && !error;

  useEffect(() => {
    // The list follows the KB: a change starts another look, the older answer is
    // dropped, and what is shown stays up until the newer one arrives.
    async function find() {
      const id = ++request.current;
      try {
        const value = await host.backlinks(scopeId, path);
        if (request.current !== id) return;
        setResult(value);
        setError('');
      } catch (error) {
        if (request.current !== id) return;
        setResult(undefined);
        setError(String(error));
      }
    }
    void find();
    const stop = host.onEvent((event) => {
      if (event.type === 'files' && event.scopeId === scopeId) void find();
    });
    return () => {
      stop();
      request.current++;
    };
  }, [scopeId, path]);

  async function open(hit: SearchHit) {
    if (opening) return;
    setOpening(true);
    setError('');
    try {
      await onOpen(hit);
    } catch (error) {
      setError(String(error));
    } finally {
      setOpening(false);
    }
  }

  return (
    <Dialog
      label={t('リンク元', 'Backlinks')}
      className="modal-dialog search-dialog"
      busy={opening}
      onClose={onClose}
    >
      <div className="search-heading">
        <h2>{t('リンク元', 'Backlinks')}</h2>
        <button onClick={onClose} disabled={opening}>
          {t('閉じる', 'Close')}
        </button>
      </div>
      <p className="muted">
        {t(
          `${path} にリンクしている、この KB のノートです。`,
          `Notes in this KB that link to ${path}.`,
        )}
      </p>
      {error && (
        <p className="search-error" role="alert">
          {error}
        </p>
      )}
      <div role="status" aria-live="polite">
        {finding && <p>{t('リンク元を調べています…', 'Looking for backlinks…')}</p>}
        {result && (
          <p>
            {t(`${result.hits.length} 件のリンク`, `${result.hits.length} links`)} ·{' '}
            {t(`${result.scannedFiles} ノートを確認`, `${result.scannedFiles} notes checked`)}
          </p>
        )}
      </div>
      {result && (
        <section aria-label={t('リンク元の一覧', 'List of backlinks')}>
          {result.incomplete && (
            <p className="search-notice">
              {t(
                '確認できた範囲の結果です。上限または読めないファイルにより、すべてのノートを確認できていません。',
                'These are the results within what could be checked. A limit or unreadable files meant not every note could be checked.',
              )}
            </p>
          )}
          {!result.hits.length && (
            <p>
              {result.incomplete
                ? t(
                    '確認できた範囲に、このノートへのリンクはありません。',
                    'No links to this note within what could be checked.',
                  )
                : t('このノートへのリンクはありません。', 'No links to this note.')}
            </p>
          )}
          <Hits hits={result.hits} disabled={opening} onOpen={open} />
        </section>
      )}
    </Dialog>
  );
}
