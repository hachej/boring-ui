import type { ReactNode } from 'react';
import { cn } from '../utils/utils';

export type DataColumn<Row> = {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  /** Numbers: right-aligned, monospace, tabular. */
  numeric?: boolean;
  /**
   * 1 is the row's title in the stacked view and always shown in the table. 2 shows from 520px of container width. 3 shows only from
   * 720px. The container decides, never the viewport.
   */
  priority: 1 | 2 | 3;
  /** A fixed column width (a length or a percentage) for the fixed table layout. */
  width?: string;
};

export type DataTableProps<Row> = {
  columns: DataColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Read by screen readers; visually hidden. */
  caption: string;
  className?: string;
};

// Container queries, not media queries: a table in a narrow side panel stacks even on a wide screen. Class names stay literal so the
// Tailwind scanner sees them.
const visibility = (priority: 1 | 2 | 3) => (priority === 3 ? 'hidden @min-[720px]:table-cell' : '');

/**
 * A fixed-layout table that never scrolls sideways. Cells truncate. Below 520px of container width each row becomes a title plus
 * label/value pairs (the priority-1 column is the title). Both forms render; the container query picks one.
 */
export function DataTable<Row>({ columns, rows, rowKey, caption, className }: DataTableProps<Row>) {
  const title = columns.find(column => column.priority === 1) ?? columns[0];
  const details = columns.filter(column => column !== title);
  return (
    <div className={cn('@container min-w-0 overflow-hidden', className)}>
      <table className="hidden w-full table-fixed border-collapse text-xs @min-[520px]:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            {columns.map(column => (
              <th
                key={column.id}
                scope="col"
                style={{ width: column.width }}
                className={cn('truncate px-2 py-1.5 font-normal', visibility(column.priority), column.numeric && 'text-right')}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={rowKey(row)} className="hover:bg-accent">
              {columns.map(column => (
                <td
                  key={column.id}
                  className={cn('truncate px-2 py-2', visibility(column.priority), column.numeric && 'text-right font-mono tabular-nums')}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="flex flex-col @min-[520px]:hidden">
        {rows.map(row => (
          <li key={rowKey(row)} className="flex min-w-0 flex-col gap-1 rounded-(--radius) px-2 py-2 hover:bg-accent">
            <span className="truncate text-sm font-medium">{title?.cell(row)}</span>
            <dl className="flex flex-col gap-1">
              {details.map(column => (
                <div key={column.id} className="flex min-w-0 items-baseline justify-between gap-3 text-xs">
                  <dt className="shrink-0 text-muted-foreground">{column.header}</dt>
                  <dd className={cn('min-w-0 truncate text-right', column.numeric && 'font-mono tabular-nums')}>{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
