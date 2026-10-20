export type RecordColumnType = 'text' | 'number' | 'date' | 'status';
export type RecordTone = 'ok' | 'warn' | 'error' | 'info' | 'neutral';
export interface RecordStatus { readonly label: string; readonly tone: RecordTone }
export interface RecordColumn { readonly key: string; readonly label: string; readonly type: RecordColumnType }
export interface RecordAction { readonly id: string; readonly label: string }
export type RecordValue = string | number | RecordStatus | null;
export interface RecordRow {
  readonly id: string;
  readonly values: Readonly<Record<string, RecordValue>>;
  readonly actions?: readonly RecordAction[] | undefined;
}
export interface RecordsFile {
  readonly kind: 'records@1';
  readonly columns: readonly RecordColumn[];
  readonly rows: readonly RecordRow[];
  readonly groupBy?: string | undefined;
}
export type RecordsParse = { readonly kind: 'ok'; readonly records: RecordsFile } | { readonly kind: 'invalid' };

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const tones = new Set(['ok', 'warn', 'error', 'info', 'neutral']);
const types = new Set(['text', 'number', 'date', 'status']);
const unique = (values: readonly string[]) => new Set(values).size === values.length;

/** ISO calendar dates or timestamps with an explicit timezone; calendar days must exist, not roll into the next month. */
export function isRecordDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  const day = value.slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(Date.parse(value)) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

/** Untrusted files are all-or-nothing: no row or cell is silently dropped. File actions are data, never executable code. */
export function parseRecords(text: string): RecordsParse {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { kind: 'invalid' }; }
  if (!object(value) || value.kind !== 'records@1' || !Array.isArray(value.columns) || !value.columns.length || !Array.isArray(value.rows)) return { kind: 'invalid' };
  if (!value.columns.every(column => object(column) && nonempty(column.key) && nonempty(column.label) && typeof column.type === 'string' && types.has(column.type))) return { kind: 'invalid' };
  const columns = value.columns as unknown as readonly RecordColumn[];
  const keys = new Set(columns.map(column => column.key));
  if (keys.size !== columns.length || value.groupBy !== undefined && (typeof value.groupBy !== 'string' || !keys.has(value.groupBy))) return { kind: 'invalid' };
  for (const row of value.rows) {
    if (!object(row) || !nonempty(row.id) || !object(row.values) || Object.keys(row.values).some(key => !keys.has(key))) return { kind: 'invalid' };
    for (const column of columns) {
      const cell = Object.hasOwn(row.values, column.key) ? row.values[column.key] : null;
      if (cell === null) continue;
      if (column.type === 'text' && typeof cell === 'string' || column.type === 'number' && typeof cell === 'number' && Number.isFinite(cell) || column.type === 'date' && typeof cell === 'string' && isRecordDate(cell) || column.type === 'status' && object(cell) && nonempty(cell.label) && typeof cell.tone === 'string' && tones.has(cell.tone)) continue;
      return { kind: 'invalid' };
    }
    if (row.actions !== undefined && (!Array.isArray(row.actions) || !row.actions.every(action => object(action) && nonempty(action.id) && nonempty(action.label)) || !unique(row.actions.map(action => action.id)))) return { kind: 'invalid' };
  }
  if (!unique(value.rows.map(row => row.id))) return { kind: 'invalid' };
  return { kind: 'ok', records: value as unknown as RecordsFile };
}

export const isRecordsPath = (path: string): boolean => /\.records\.json$/i.test(path);
export const recordValue = (row: RecordRow, key: string): RecordValue => Object.hasOwn(row.values, key) ? row.values[key] ?? null : null;

/** Dates display in UTC so a calendar date does not move to the previous day in a viewer's timezone. */
export function formatRecordValue(value: RecordValue, type: RecordColumnType, locale = 'en', missing = '—'): string {
  if (value === null) return missing;
  if (typeof value === 'object') return value.label;
  if (type === 'number' && typeof value === 'number') return new Intl.NumberFormat(locale).format(value);
  if (type === 'date' && typeof value === 'string' && isRecordDate(value)) return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
  return String(value);
}
