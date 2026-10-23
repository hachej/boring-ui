// The looks viewer on the fictional « missing receipts » files: the looks grid (?file=looks) or the layout grid (?file=layouts).
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { LooksViewer } from '../../registry/looks-viewer/looks-viewer';
import type { LookPick } from '../../registry/looks-viewer/looks-viewer';

const { files } = JSON.parse(document.getElementById('boot')!.textContent!) as { files: Record<string, string> };
const which = new URLSearchParams(location.search).get('file') === 'layouts' ? 'missing-receipts-layouts.looks.json' : 'missing-receipts.looks.json';
const read = async (path: string) => files[path.replace(/^fixtures\//, '')];
declare global { interface Window { __picks: LookPick[] } }
window.__picks = [];
function App() {
  const [picked, setPicked] = useState<LookPick>();
  return <main className="mx-auto flex max-w-6xl flex-col gap-2 p-2">
    <LooksViewer text={files[which]!} path={`fixtures/${which}`} read={read} onPick={pick => { window.__picks.push(pick); setPicked(pick); }} />
    <p role="status" data-testid="picked" className="px-3 text-sm text-muted-foreground">{picked ? `Picked ${picked.kind}: ${picked.label}` : 'Nothing picked yet'}</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
