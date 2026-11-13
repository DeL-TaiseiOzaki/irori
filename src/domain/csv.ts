import Papa from 'papaparse';
import { t } from './i18n';

export type CsvTable = { columns: string[]; rows: string[][] };

// The table view never serializes a CSV. The original document remains authoritative.
export function parseCsv(text: string): CsvTable {
  const result = Papa.parse<string[]>(text, {
    delimiter: ',',
    skipEmptyLines: 'greedy',
    preview: 20002,
  });
  if (result.errors.length) throw Error(`CSV: ${result.errors[0].message}`);
  const [columns = [], ...rows] = result.data;
  if (
    !columns.length ||
    columns.some((name) => !name.trim()) ||
    new Set(columns).size !== columns.length
  )
    throw Error(
      t('CSV の列名は空欄・重複にできません。', 'CSV column names cannot be blank or duplicated.'),
    );
  if (rows.length > 20000 || columns.length > 100)
    throw Error(
      t(
        'CSV 表示は 20,000 行・100 列までです。',
        'The CSV view shows up to 20,000 rows and 100 columns.',
      ),
    );
  if (rows.some((row) => row.length !== columns.length))
    throw Error(t('CSV の列数が一致しません。', 'The CSV rows have different numbers of columns.'));
  return { columns, rows };
}
