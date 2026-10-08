// One component used twice with the same text and no identity: a pin on either is ambiguous, so Show must ask which one.
export function ExportButton({ onExport }) {
  return <button type="button" className="ly-btn" onClick={onExport}>Export</button>;
}
