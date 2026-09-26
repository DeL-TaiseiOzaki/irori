import { useEffect, useMemo, useState } from 'react';
import { read, utils, type WorkBook } from 'xlsx';
import { t } from '../../domain/i18n';
import type { ViewProps } from './common';

const pageRows = 200;
/** Columns past this are summarized rather than drawn; a sheet this wide is rare. */
const columnLimit = 200;

/** A spreadsheet's sheets as tables of the values Excel would display, one sheet at a time. */
export default function SheetView({ bytes, zoom, onInfo }: ViewProps) {
  const [book, setBook] = useState<WorkBook>();
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState(0);
  const [page, setPage] = useState(0);
  useEffect(() => {
    // Parsing is synchronous; let the frame show its waiting line first.
    const timer = setTimeout(() => {
      try {
        const loaded = read(bytes, { type: 'array', dense: true, cellHTML: false, WTF: false });
        setBook(loaded);
        setSheet(0);
        setPage(0);
        onInfo(t(`${loaded.SheetNames.length} シート`, `${loaded.SheetNames.length} sheets`));
      } catch (reason) {
        setError(
          t(
            `スプレッドシートを読めませんでした: ${(reason as Error).message}`,
            `Could not read the spreadsheet: ${(reason as Error).message}`,
          ),
        );
      }
    });
    return () => clearTimeout(timer);
  }, [bytes]);
  const table = useMemo(() => {
    if (!book) return undefined;
    const ws = book.Sheets[book.SheetNames[sheet]];
    if (!ws?.['!ref']) return { rows: [] as string[][], columns: 0, first: 0, merges: [] };
    const range = utils.decode_range(ws['!ref']);
    const rows = utils.sheet_to_json<string[]>(ws, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
    });
    return {
      rows,
      columns: range.e.c - range.s.c + 1,
      first: range.s.c,
      firstRow: range.s.r,
      merges: ws['!merges'] ?? [],
    };
  }, [book, sheet]);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!book || !table)
    return (
      <p className="hint">{t('スプレッドシートを開いています…', 'Opening the spreadsheet…')}</p>
    );
  const pages = Math.max(1, Math.ceil(table.rows.length / pageRows));
  const current = Math.min(page, pages - 1);
  const start = current * pageRows;
  const shown = table.rows.slice(start, start + pageRows);
  const columns = Math.min(table.columns, columnLimit);
  const firstRow = table.firstRow ?? 0;
  // Cells a merge covers are skipped; its top-left cell spans them.
  const spans = new Map<string, { rows: number; cols: number }>();
  const covered = new Set<string>();
  for (const merge of table.merges) {
    const row = merge.s.r - firstRow;
    const col = merge.s.c - table.first;
    spans.set(`${row}:${col}`, {
      rows: merge.e.r - merge.s.r + 1,
      cols: merge.e.c - merge.s.c + 1,
    });
    for (let r = merge.s.r; r <= merge.e.r; r++)
      for (let c = merge.s.c; c <= merge.e.c; c++)
        if (r !== merge.s.r || c !== merge.s.c) covered.add(`${r - firstRow}:${c - table.first}`);
  }
  return (
    <section className="sheet-view" aria-label={t('スプレッドシート', 'Spreadsheet')}>
      <div className="sheet-tabs" role="tablist" aria-label={t('シート', 'Sheets')}>
        {book.SheetNames.map((name, index) => (
          <button
            key={name}
            role="tab"
            aria-selected={index === sheet}
            className={index === sheet ? 'on' : ''}
            onClick={() => {
              setSheet(index);
              setPage(0);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="actions">
        <p>
          {t(
            `${table.rows.length} 行 · ${table.columns} 列`,
            `${table.rows.length} rows · ${table.columns} columns`,
          )}
          {table.columns > columnLimit && (
            <span className="muted">
              {' '}
              {t(`（先頭 ${columnLimit} 列を表示）`, `(showing the first ${columnLimit} columns)`)}
            </span>
          )}
        </p>
        {pages > 1 && (
          <>
            <button disabled={!current} onClick={() => setPage(current - 1)}>
              {t(`前の ${pageRows} 行`, `Previous ${pageRows} rows`)}
            </button>
            <span>
              {start + 1}–{Math.min(table.rows.length, start + pageRows)}
            </span>
            <button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
              {t(`次の ${pageRows} 行`, `Next ${pageRows} rows`)}
            </button>
          </>
        )}
      </div>
      <div className="sheet-scroll" tabIndex={0} style={{ zoom }}>
        <table>
          <thead>
            <tr>
              <th className="corner" />
              {Array.from({ length: columns }, (_, index) => (
                <th scope="col" key={index}>
                  {utils.encode_col(table.first + index)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, offset) => {
              const r = start + offset;
              return (
                <tr key={r}>
                  <th scope="row">{firstRow + r + 1}</th>
                  {Array.from({ length: columns }, (_, c) => {
                    if (covered.has(`${r}:${c}`)) return null;
                    const span = spans.get(`${r}:${c}`);
                    return (
                      <td key={c} rowSpan={span?.rows} colSpan={span?.cols}>
                        {row[c] ?? ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
