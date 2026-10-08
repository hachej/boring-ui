// A data region left unmarked: its text is masked in every snapshot, label and report.
const ACTIVITY = [['Mara Quill', 'paid invoice F-2210', '2 min ago'], ['Tobin Reyes', 'joined the studio', '1 h ago'], ['Ines Vale', 'exported receipts', 'Yesterday']];

export function ActivityPanel() {
  return <aside className="fh-activity" aria-label="Recent activity" data-testid="activity">
    <h2>Recent activity</h2>
    <ul>{ACTIVITY.map(([who, what, when]) => <li key={who + what}><strong>{who}</strong> {what}<time>{when}</time></li>)}</ul>
  </aside>;
}
