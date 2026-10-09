// FeedbackList: stored feedback, newest first, as the host's authorized list route returns it. Rows are `listRows` from
// `@hachej/boring-feedback/ui`; an unprotected store is stated above them.
import type { FeedbackListItem } from '@hachej/boring-feedback/format';
import { listRows, protectionNotice, type FeedbackProtection } from '@hachej/boring-feedback/ui';

export interface FeedbackListProps {
  readonly items: readonly FeedbackListItem[];
  readonly protection: FeedbackProtection;
  readonly onOpen: (id: string) => void;
  /** The open item, highlighted. */
  readonly activeId?: string;
  /** Why the list could not be loaded (denied, unavailable). */
  readonly problem?: string;
  readonly now?: Date;
}

export function FeedbackList({ items, protection, onOpen, activeId, problem, now }: FeedbackListProps) {
  const notice = protectionNotice(protection);
  const rows = listRows(items, now);
  return <section data-boring="feedback" data-feedback-ignore="" className="boring-feedback-list" aria-label="Feedback" data-testid="feedback-list">
    {notice && <p className="boring-feedback-notice" data-testid="feedback-protection">{notice}</p>}
    {problem !== undefined && <p role="alert" className="boring-feedback-warning">{problem}</p>}
    {problem === undefined && rows.length === 0 && <p className="boring-feedback-empty">No feedback yet. Point at something to leave some.</p>}
    <ul>
      {rows.map(row => <li key={row.id}>
        <button type="button" data-testid="feedback-item" data-id={row.id} aria-current={row.id === activeId ? 'true' : undefined} onClick={() => onOpen(row.id)}>
          <span className="boring-feedback-title">{row.title}</span>
          <span className="boring-feedback-meta"><span data-status={row.status}>{row.status}</span> · {row.where} · {row.age}</span>
        </button>
      </li>)}
    </ul>
  </section>;
}
