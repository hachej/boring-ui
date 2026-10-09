export function SaveBar({ label }: { label: string }) {
  return (
    <div className="save-bar">
      <button type="button">{label}</button>
    </div>
  );
}
