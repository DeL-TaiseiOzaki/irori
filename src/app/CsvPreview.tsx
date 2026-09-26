import { useMemo, useState } from 'react';
import { parseCsv } from '../domain/ontology';
import { t } from '../domain/i18n';
import { errorText } from './ErrorMessage';

export function CsvPreview({ text }: { text: string }) {
  const [page, setPage] = useState(0);
  const result = useMemo(() => {
    try {
      return { table: parseCsv(text) };
    } catch (error) {
      return { error: errorText(error) };
    }
  }, [text]);
  if (!result.table)
    return (
      <p className="error" role="alert">
        {result.error}
      </p>
    );
  const { columns, rows } = result.table;
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 100) - 1));
  return (
    <section className="csv-preview" aria-label={t('CSV の表', 'CSV table')}>
      <div className="actions">
        <p>
          {t(
            `${rows.length} 行 · ${columns.length} 列`,
            `${rows.length} rows · ${columns.length} columns`,
          )}{' '}
          <span className="muted">{t('編集は「ソース」から', 'Edit from "Source"')}</span>
        </p>
        <button disabled={!current} onClick={() => setPage(current - 1)}>
          {t('前の 100 行', 'Previous 100 rows')}
        </button>
        <span>
          {current * 100 + (rows.length ? 1 : 0)}–{Math.min(rows.length, (current + 1) * 100)}
        </span>
        <button disabled={(current + 1) * 100 >= rows.length} onClick={() => setPage(current + 1)}>
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
              {columns.map((column) => (
                <th scope="col" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(current * 100, (current + 1) * 100).map((row, index) => (
              <tr key={current * 100 + index}>
                {row.map((value, column) => (
                  <td key={column}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
