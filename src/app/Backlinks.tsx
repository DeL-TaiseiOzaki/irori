import { useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import type { KnowledgeSearch, SearchHit } from '../domain/search';
import { t } from '../domain/i18n';
import { Icon } from './Icon';
import { useResource } from './useResource';

const host = window.irori;

/**
 * The notes of this KB whose links lead to `path`. The list shows the same scan
 * as the count on the button: one look at the KB, so neither answer cancels
 * the other, and it follows the KB's changes with the count.
 */
function BacklinksList({
  path,
  result,
  error: failure,
  onOpen,
}: {
  path: string;
  result?: KnowledgeSearch;
  error?: string;
  onOpen: (hit: SearchHit) => Promise<void>;
}) {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const error = openError || (result ? '' : (failure ?? ''));
  const finding = !result && !error;
  async function open(hit: SearchHit) {
    if (opening) return;
    setOpening(true);
    setOpenError('');
    try {
      await onOpen(hit);
    } catch (error) {
      setOpenError(String(error));
    } finally {
      setOpening(false);
    }
  }
  return (
    <>
      <p className="muted backlinks-lead">
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
      <div role="status" aria-live="polite" className="backlinks-status">
        {finding && t('リンク元を調べています…', 'Looking for backlinks…')}
        {result &&
          `${t(`${result.hits.length} 件のリンク`, `${result.hits.length} links`)} · ${t(
            `${result.scannedFiles} ノートを確認`,
            `${result.scannedFiles} notes checked`,
          )}`}
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
            <p className="backlinks-empty">
              {result.incomplete
                ? t(
                    '確認できた範囲に、このノートへのリンクはありません。',
                    'No links to this note within what could be checked.',
                  )
                : t('このノートへのリンクはありません。', 'No links to this note.')}
            </p>
          )}
          <ul className="backlinks-hits">
            {result.hits.map((hit) => (
              <li key={`${hit.path}:${hit.line}`}>
                <button disabled={opening} onClick={() => void open(hit)}>
                  <span className="backlink-location">
                    <Icon name="file" size={14} />
                    <strong>{hit.path}</strong>
                    <small>{t(`${hit.line} 行目`, `Line ${hit.line}`)}</small>
                  </span>
                  <span className="backlink-preview">{hit.preview}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** The link button in the note's bar: how many notes lead here, and the list of them. */
export function Backlinks({
  scopeId,
  path,
  revision,
  onOpen,
}: {
  scopeId: string;
  path: string;
  /** Changes when the KB's files change, so the count follows them. */
  revision: number;
  onOpen: (hit: SearchHit) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const read = useResource(() => host.backlinks(scopeId, path), [scopeId, path], {
    refresh: revision,
    delay: 300,
  });
  const count = read.data?.hits.length;
  const label =
    count === undefined
      ? t('リンク元', 'Backlinks')
      : t(`リンク元 ${count} 件`, `${count} backlinks`);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="stage-button backlinks-trigger" aria-label={label} title={label}>
        <Icon name="link" size={16} />
        {!!count && <span className="backlinks-count">{count}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6}>
          <Popover.Popup className="stage-popover backlinks-popover">
            <div className="backlinks-heading">
              <Popover.Title render={<h3 />}>{t('リンク元', 'Backlinks')}</Popover.Title>
              <Popover.Close className="stage-button" aria-label={t('閉じる', 'Close')}>
                <Icon name="close" size={15} />
              </Popover.Close>
            </div>
            <BacklinksList
              path={path}
              result={read.data}
              error={read.error}
              onOpen={async (hit) => {
                await onOpen(hit);
                setOpen(false);
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
