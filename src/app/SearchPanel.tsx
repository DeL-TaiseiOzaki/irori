import { useEffect, useRef, useState } from 'react';
import type { KnowledgeSearch, SearchHit } from '../domain/search';
import type { Space } from '../domain/types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

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
          '編集中のノートを保存できませんでした。閉じて、保存や競合の状態を確認してください。',
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
      label="KB内を検索"
      className="modal-dialog search-dialog"
      busy={opening}
      onClose={onClose}
    >
      <div className="search-heading">
        <h2>
          <Icon name="search" size={20} /> KB内を検索
        </h2>
        <button onClick={onClose} disabled={opening}>
          閉じる
        </button>
      </div>
      <p className="muted" id="search-scope-help">
        選んだローカル KB の本文を検索します。スキーマ・contents・Drive は対象外です。
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label>
          検索する KB
          <select
            aria-label="検索する KB"
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
          本文を検索
          <input
            ref={queryInput}
            type="search"
            aria-label="本文を検索"
            aria-describedby="search-query-help"
            maxLength={200}
            value={query}
            disabled={opening}
            placeholder="ノート本文の言葉を入力"
            onChange={(event) => {
              invalidate();
              setQuery(event.target.value);
            }}
          />
        </label>
        <div className="search-submit">
          <p className="muted" id="search-query-help">
            文字列として検索します。英字の大文字・小文字は区別しません（最大 200 文字）。
          </p>
          <button
            className="primary"
            type="submit"
            disabled={!member || !query.trim() || searching || opening}
          >
            {searching ? '検索中…' : '検索'}
          </button>
        </div>
      </form>
      {error && (
        <p className="search-error" role="alert">
          {error}
        </p>
      )}
      <div role="status" aria-live="polite">
        {searching && <p>本文を検索しています…</p>}
        {result && (
          <p>
            {result.hits.length} 件の一致 · {result.scannedFiles} ファイルを検索
          </p>
        )}
      </div>
      {result && (
        <section aria-label="本文の検索結果">
          {(result.incomplete || result.skippedFiles > 0) && (
            <p className="search-notice">
              {result.incomplete &&
                '検索できた範囲の結果です。上限または読めないファイルにより、すべての本文を確認できていません。'}
              {result.skippedFiles > 0 && ` ${result.skippedFiles} ファイルをスキップしました。`}{' '}
              必要に応じて検索語を絞って再検索してください。
            </p>
          )}
          {changed && (
            <p className="search-notice">
              KB のファイルが更新されました。最新の内容を確認するには再検索してください。
            </p>
          )}
          {!result.hits.length && (
            <p>
              {result.incomplete
                ? '検索できた範囲に一致する本文はありません。'
                : '一致する本文はありません。'}
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
              <small>{hit.line} 行目</small>
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
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const finding = !result && !error;

  async function find() {
    const id = ++request.current;
    setResult(undefined);
    setError('');
    setChanged(false);
    try {
      const value = await host.backlinks(scopeId, path);
      if (request.current === id) setResult(value);
    } catch (error) {
      if (request.current === id) setError(String(error));
    }
  }
  useEffect(() => {
    void find();
    return () => {
      request.current++;
    };
  }, []);
  useEffect(
    () =>
      host.onEvent((event) => {
        if (event.type === 'files' && event.scopeId === scopeId) setChanged(true);
      }),
    [scopeId],
  );

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
      label="リンク元"
      className="modal-dialog search-dialog"
      busy={opening}
      onClose={onClose}
    >
      <div className="search-heading">
        <h2>リンク元</h2>
        <div className="actions">
          <button onClick={() => void find()} disabled={finding || opening}>
            もう一度調べる
          </button>
          <button onClick={onClose} disabled={opening}>
            閉じる
          </button>
        </div>
      </div>
      <p className="muted">{path} にリンクしている、この KB のノートです。</p>
      {error && (
        <p className="search-error" role="alert">
          {error}
        </p>
      )}
      <div role="status" aria-live="polite">
        {finding && <p>リンク元を調べています…</p>}
        {result && (
          <p>
            {result.hits.length} 件のリンク · {result.scannedFiles} ノートを確認
          </p>
        )}
      </div>
      {result && (
        <section aria-label="リンク元の一覧">
          {result.incomplete && (
            <p className="search-notice">
              確認できた範囲の結果です。上限または読めないファイルにより、すべてのノートを確認できていません。
            </p>
          )}
          {changed && (
            <p className="search-notice">
              KB のファイルが更新されました。最新の内容は「もう一度調べる」で確認できます。
            </p>
          )}
          {!result.hits.length && (
            <p>
              {result.incomplete
                ? '確認できた範囲に、このノートへのリンクはありません。'
                : 'このノートへのリンクはありません。'}
            </p>
          )}
          <Hits hits={result.hits} disabled={opening} onOpen={open} />
        </section>
      )}
    </Dialog>
  );
}
