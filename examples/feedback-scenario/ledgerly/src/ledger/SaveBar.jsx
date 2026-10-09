// The entry form's action row. The Save button has a data-testid, the row a data-feedback-id: the identities feedback anchors use.
export function SaveBar({ saved }) {
  return <div className="ly-actions" data-feedback-id="entry-actions">
    <button type="submit" className="ly-btn primary" data-testid="save-entry">Save entry</button>
    <span className="ly-note" role="status" data-testid="entry-saved">{saved}</span>
  </div>;
}
