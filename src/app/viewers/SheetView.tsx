import { useEffect, useMemo, useRef, useState } from 'react';
import { read, utils, type WorkBook } from 'xlsx';
import { findAll } from '../../domain/find';
import { t } from '../../domain/i18n';
import { FindMarks, reveal, useFinder, type Finder } from '../FindBar';
import type { ViewProps } from './common';

const pageRows = 200;
/** Columns past this are summarized rather than drawn; a sheet this wide is rare. */
const columnLimit = 200;
/** The most rows read from one sheet. */
const rowLimit = 100_000;

interface SheetTable {
  rows: string[][];
  columns: number;
  first: number;
  firstRow?: number;
  merges: import('xlsx').Range[];
}

/** A sheet's values as Excel would display them, within the rows and columns shown. */
function readSheet(book: WorkBook, index: number): SheetTable {
  const ws = book.Sheets[book.SheetNames[index]];
  if (!ws?.['!ref']) return { rows: [], columns: 0, first: 0, merges: [] };
  const declared = utils.decode_range(ws['!ref']);
  // A file can declare a range of every row and column; only what can be shown is read.
  const range = {
    s: declared.s,
    e: {
      r: Math.min(declared.e.r, declared.s.r + rowLimit - 1),
      c: Math.min(declared.e.c, declared.s.c + columnLimit - 1),
    },
  };
  const rows = utils.sheet_to_json<string[]>(ws, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
    range,
  });
  return {
    rows,
    columns: declared.e.c - declared.s.c + 1,
    first: range.s.c,
    firstRow: range.s.r,
    merges: ws['!merges'] ?? [],
  };
}

/** An occurrence in the workbook: a sheet, a row of its table, a column and where in the cell. */
interface Hit {
  sheet: number;
  row: number;
  column: number;
  at: number;
}
const before = (a: Hit, b: Hit) =>
  a.sheet - b.sheet || a.row - b.row || a.column - b.column || a.at - b.at;

/** A spreadsheet's sheets as tables of the values Excel would display, one sheet at a time. */
export default function SheetView({ bytes, zoom, onInfo }: ViewProps) {
  const [book, setBook] = useState<WorkBook>();
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState(0);
  const [page, setPage] = useState(0);
  // Each sheet is read once, for the table on show or for the find bar.
  const sheets = useRef(new Map<number, SheetTable>());
  const sheetAt = (current: WorkBook, index: number) => {
    let table = sheets.current.get(index);
    if (!table) sheets.current.set(index, (table = readSheet(current, index)));
    return table;
  };
  // The find bar looks in every sheet; an occurrence elsewhere opens its sheet and page.
  const [marks, setMarks] = useState<{ query: string; current?: Hit; scroll: number }>({
    query: '',
    scroll: 0,
  });
  const view = useRef<HTMLElement>(null);
  const live = useRef({ book, sheet, page, hits: [] as Hit[], current: -1 });
  Object.assign(live.current, { book, sheet, page });
  const finder = useMemo<Finder>(
    () => ({
      find(query) {
        const { book: current, sheet: shown, page: at, hits: last, current: index } = live.current;
        const previous = last[index];
        const hits: Hit[] = [];
        if (current && query)
          current.SheetNames.forEach((_, number) => {
            const { rows } = sheetAt(current, number);
            rows.forEach((row, r) =>
              row.forEach((value, column) => {
                for (const offset of findAll(String(value ?? ''), query))
                  hits.push({ sheet: number, row: r, column, at: offset });
              }),
            );
          });
        live.current.hits = hits;
        live.current.current = -1;
        setMarks((value) => ({ query, scroll: value.scroll }));
        // From the occurrence last shown, or else from the page on show.
        const from = previous ?? { sheet: shown, row: at * pageRows, column: 0, at: 0 };
        return {
          count: hits.length,
          start: Math.max(
            0,
            hits.findIndex((hit) => before(hit, from) >= 0),
          ),
        };
      },
      show(index, scroll) {
        const hit = live.current.hits[index];
        if (!hit) return;
        live.current.current = index;
        setSheet(hit.sheet);
        setPage(Math.floor(hit.row / pageRows));
        setMarks((value) => ({
          ...value,
          current: hit,
          scroll: scroll ? value.scroll + 1 : value.scroll,
        }));
      },
      clear() {
        live.current.hits = [];
        live.current.current = -1;
        setMarks((value) => ({ query: '', scroll: value.scroll }));
        return false;
      },
    }),
    [],
  );
  const changed = useFinder(finder);
  useEffect(changed, [book]);
  useEffect(() => {
    if (marks.scroll) reveal(view.current?.querySelector('.find-hit.current'));
  }, [marks.scroll]);
  useEffect(() => {
    // Parsing is synchronous; let the frame show its waiting line first.
    const timer = setTimeout(() => {
      try {
        const loaded = read(bytes, { type: 'array', dense: true, cellHTML: false, WTF: false });
        sheets.current.clear();
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
  const table = useMemo(() => (book ? sheetAt(book, sheet) : undefined), [book, sheet]);
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
    // Only the cells on this page: a merge may name a whole sheet.
    const top = Math.max(merge.s.r, firstRow + start);
    const bottom = Math.min(merge.e.r, firstRow + start + pageRows - 1);
    const right = Math.min(merge.e.c, table.first + columns - 1);
    for (let r = top; r <= bottom; r++)
      for (let c = merge.s.c; c <= right; c++)
        if (r !== merge.s.r || c !== merge.s.c) covered.add(`${r - firstRow}:${c - table.first}`);
  }
  // As in Excel, the grid fills the viewer and the sheet tabs stay along its lower edge.
  return (
    <section ref={view} className="sheet-view" aria-label={t('スプレッドシート', 'Spreadsheet')}>
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
      {/* A new sheet starts at its first cell, wherever the last one was scrolled to. */}
      <div key={sheet} className="sheet-scroll" tabIndex={0}>
        <table style={{ zoom }}>
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
                        <FindMarks
                          text={String(row[c] ?? '')}
                          query={marks.query}
                          current={
                            marks.current?.sheet === sheet &&
                            marks.current.row === r &&
                            marks.current.column === c
                              ? marks.current.at
                              : undefined
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sheet-tabs" role="tablist" aria-label={t('シート', 'Sheets')}>
        {book.SheetNames.map((name, index) => (
          <button
            key={name}
            role="tab"
            aria-selected={index === sheet}
            className={index === sheet ? 'on' : ''}
            title={name}
            onClick={() => {
              setSheet(index);
              setPage(0);
            }}
          >
            {name}
          </button>
        ))}
      </div>
    </section>
  );
}
