// One button component used twice: both buttons share their source location and text, and neither has an identity, so a pin on
// either resolves `ambiguous` and the person chooses.
export function ExportButton({ onExport }) {
  return <button type="button" className="fh-btn" onClick={onExport}>Export CSV</button>;
}
