import { useEffect, useMemo, useRef, useState } from 'react';
import { parseCsv } from '../domain/ontology';
import { findAll } from '../domain/find';
import { t } from '../domain/i18n';
import { errorText } from './ErrorMessage';
import { FindMarks, reveal, useFinder, type Finder } from './FindBar';

const pageRows = 100;

/** An occurrence in the table: a row (-1 for the header), a column and where in the cell. */
interface Hit {
  row: number;
  column: number;
  at: number;
}
const before = (a: Hit, b: Hit) => a.row - b.row || a.column - b.column || a.at - b.at;

export function CsvPreview({ text }: { text: string }) {
  const [page, setPage] = useState(0);
  const result = useMemo(() => {
    try {
      return { table: parseCsv(text) };
    } catch (error) {
      return { error: errorText(error) };
    }
  }, [text]);
  // The find bar's occurrences are found in every row, not only the page on show.
  const [marks, setMarks] = useState<{ query: string; current?: Hit; scroll: number }>({
    query: '',
    scroll: 0,
  });
  const section = useRef<HTMLElement>(null);
  const live = useRef({ table: result.table, page, hits: [] as Hit[], current: -1 });
  live.current.table = result.table;
  live.current.page = page;
  const finder = useMemo<Finder>(
    () => ({
      find(query) {
        const { table, page: shown, hits: last, current } = live.current;
        const previous = last[current];
        const hits: Hit[] = [];
        if (table && query) {
          table.columns.forEach((value, column) => {
            for (const at of findAll(value, query)) hits.push({ row: -1, column, at });
          });
          table.rows.forEach((row, index) =>
            row.forEach((value, column) => {
              for (const at of findAll(value, query)) hits.push({ row: index, column, at });
            }),
          );
        }
        live.current.hits = hits;
        live.current.current = -1;
        setMarks((value) => ({ query, scroll: value.scroll }));
        // From the occurrence last shown, or else from the page on show.
        const from = previous ?? { row: shown * pageRows, column: 0, at: 0 };
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
        if (hit.row >= 0) setPage(Math.floor(hit.row / pageRows));
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
  useEffect(changed, [result.table]);
  useEffect(() => {
    if (marks.scroll) reveal(section.current?.querySelector('.find-hit.current'));
  }, [marks.scroll]);
  // A file just made has nothing to show yet; that is not an error.
  if (!text.trim()) return <p className="muted">{t('空の CSV', 'Empty CSV')}</p>;
  if (!result.table)
    return (
      <p className="error" role="alert">
        {result.error}
      </p>
    );
  const { columns, rows } = result.table;
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / pageRows) - 1));
  const cell = (value: string, row: number, column: number) => (
    <FindMarks
      text={value}
      query={marks.query}
      current={
        marks.current?.row === row && marks.current.column === column ? marks.current.at : undefined
      }
    />
  );
  return (
    <section ref={section} className="csv-preview" aria-label={t('CSV の表', 'CSV table')}>
      <div className="actions">
        <p>
          {t(
            `${rows.length} 行 · ${columns.length} 列`,
            `${rows.length} rows · ${columns.length} columns`,
          )}
        </p>
        <button disabled={!current} onClick={() => setPage(current - 1)}>
          {t('前の 100 行', 'Previous 100 rows')}
        </button>
        <span>
          {current * pageRows + (rows.length ? 1 : 0)}–
          {Math.min(rows.length, (current + 1) * pageRows)}
        </span>
        <button
          disabled={(current + 1) * pageRows >= rows.length}
          onClick={() => setPage(current + 1)}
        >
          {t('次の 100 行', 'Next 100 rows')}
        </button>
      </div>
      <div
        className="csv-scroll"
        tabIndex={0}
        aria-label={t('CSV の行と列', 'CSV rows and columns')}
      >
        <table>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th scope="col" key={column}>
                  {cell(column, -1, index)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(current * pageRows, (current + 1) * pageRows).map((row, index) => (
              <tr key={current * pageRows + index}>
                {row.map((value, column) => (
                  <td key={column}>{cell(value, current * pageRows + index, column)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
