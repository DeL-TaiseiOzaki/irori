import { useEffect, useRef, useState } from 'react';
import type { KnowledgeSearch, SearchHit } from '../domain/search';
import type { Space } from '../domain/types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { BrainTile } from './BrainTile';
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
  // The result the keyboard has chosen; Enter opens it.
  const [chosen, setChosen] = useState(0);
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
    setChosen(0);
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

  const space = spaces.find((item) => item.scopeId === scopeId);
  const hits = result?.hits ?? [];
  return (
    <Dialog
      label={t('KB内を検索', 'Search in KB')}
      className="modal-dialog search-palette"
      busy={opening}
      onClose={onClose}
    >
      <div
        className="palette chrome"
        onKeyDown={(event) => {
          // The results are chosen from the keyboard while the query keeps focus.
          if (!hits.length || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
          event.preventDefault();
          setChosen((value) =>
            event.key === 'ArrowDown'
              ? Math.min(hits.length - 1, value + 1)
              : Math.max(0, value - 1),
          );
        }}
      >
        <form
          className="palette-query"
          onSubmit={(event) => {
            event.preventDefault();
            // Enter searches a new query and opens the chosen result of the current one.
            if (result && hits[chosen]) void open(hits[chosen]);
            else void search();
          }}
        >
          <Icon name="search" size={19} />
          <input
            ref={queryInput}
            type="search"
            aria-label={t('本文を検索', 'Search body text')}
            aria-describedby="search-query-help"
            maxLength={200}
            value={query}
            disabled={opening}
            placeholder={t('Brain の本文を検索…', "Search the brain's notes…")}
            onChange={(event) => {
              invalidate();
              setQuery(event.target.value);
            }}
          />
          <button
            className="palette-submit"
            type="submit"
            disabled={!member || !query.trim() || searching || opening}
          >
            {searching ? t('検索中…', 'Searching…') : t('検索', 'Search')}
          </button>
          <button
            type="button"
            className="palette-close"
            aria-label={t('閉じる', 'Close')}
            title={t('閉じる（esc）', 'Close (esc)')}
            disabled={opening}
            onClick={onClose}
          >
            esc
          </button>
        </form>
        <div className="palette-scopes">
          <fieldset aria-describedby="search-scope-help">
            <legend className="sr-only">{t('検索する Brain', 'Brain to search')}</legend>
            {spaces.map((item) => (
              <label
                key={item.scopeId}
                className="palette-scope"
                data-checked={item.scopeId === scopeId}
              >
                <input
                  type="radio"
                  name="search-scope"
                  value={item.scopeId}
                  checked={item.scopeId === scopeId}
                  disabled={opening}
                  onChange={() => {
                    invalidate();
                    setScopeId(item.scopeId);
                  }}
                />
                <BrainTile space={item} size={16} radius={5} />
                {item.name}
              </label>
            ))}
          </fieldset>
          <span className="palette-where" id="search-scope-help">
            <Icon name="book" size={13} />
            {t('Knowledge の本文', 'Knowledge text')}
          </span>
        </div>
        {error && (
          <p className="search-error" role="alert">
            {error}
          </p>
        )}
        <div className="palette-status" role="status" aria-live="polite">
          {searching && t('本文を検索しています…', 'Searching body text…')}
          {result &&
            `${t(`${result.hits.length} 件の一致`, `${result.hits.length} matches`)} · ${t(
              `${result.scannedFiles} ファイルを検索`,
              `${result.scannedFiles} files searched`,
            )}`}
        </div>
        {result && (
          <section
            className="palette-results"
            aria-label={t('本文の検索結果', 'Body text search results')}
          >
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
              <p className="palette-empty">
                {result.incomplete
                  ? t(
                      '検索できた範囲に一致する本文はありません。',
                      'No matching body text within what could be searched.',
                    )
                  : t('一致する本文はありません。', 'No matching body text.')}
              </p>
            )}
            {!!result.hits.length && space && (
              <h3 className="palette-group">
                <BrainTile space={space} size={18} radius={5} />
                {space.name}
                <span>{result.hits.length}</span>
              </h3>
            )}
            <Hits
              hits={result.hits}
              query={result.query}
              chosen={chosen}
              disabled={opening || !member}
              onOpen={open}
            />
          </section>
        )}
        <footer className="palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            {t('選択', 'Select')}
          </span>
          <span>
            <kbd>↵</kbd>
            {t('検索・開く', 'Search · open')}
          </span>
          <span>
            <kbd>esc</kbd>
            {t('閉じる', 'Close')}
          </span>
          <span className="palette-footer-space" />
          <small className="muted" id="search-query-help">
            {t(
              '文字列として検索（英字の大小は区別しない・最大 200 文字）',
              'Literal text, ASCII case-insensitive, up to 200 characters',
            )}
          </small>
        </footer>
      </div>
    </Dialog>
  );
}

/** The matched text in a line, marked wherever it occurs (ASCII letters in either case). */
function Marked({ text, query }: { text: string; query: string }) {
  const needle = query.toLowerCase();
  const lower = text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;
  for (let at = needle ? lower.indexOf(needle) : -1; at >= 0; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  parts.push({ text: text.slice(from), match: false });
  return (
    <>
      {parts.map((part, index) => (part.match ? <mark key={index}>{part.text}</mark> : part.text))}
    </>
  );
}

function Hits({
  hits,
  query,
  chosen,
  disabled,
  onOpen,
}: {
  hits: SearchHit[];
  query: string;
  chosen: number;
  disabled: boolean;
  onOpen: (hit: SearchHit) => Promise<void>;
}) {
  return (
    <ul className="search-results">
      {hits.map((hit, index) => {
        const slash = hit.path.lastIndexOf('/') + 1;
        return (
          <li key={`${hit.path}:${hit.line}`}>
            <button
              disabled={disabled}
              aria-current={index === chosen ? 'true' : undefined}
              onClick={() => void onOpen(hit)}
            >
              <span className="search-result-location">
                <Icon name="file" size={14} />
                <span className="search-result-path">
                  <span className="search-result-folder">{hit.path.slice(0, slash)}</span>
                  <strong>{hit.path.slice(slash)}</strong>
                </span>
                <small>{t(`${hit.line} 行目`, `Line ${hit.line}`)}</small>
              </span>
              <span className="search-result-preview">
                <Marked text={hit.preview} query={query} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
