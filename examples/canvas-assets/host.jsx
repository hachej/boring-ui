// A fictional host page. Tldraw is not loaded until the person opens a canvas; the page records every security-policy violation so
// the journey can prove that the canvas makes no external request. The licence key, when the host has one, comes from its boot data.
import { Suspense, lazy, useState } from 'react';
import { createRoot } from 'react-dom/client';

const CanvasPanel = lazy(() => import('./canvas-panel.jsx'));
const boot = JSON.parse(document.getElementById('boot').textContent);
window.__cspViolations = [];
document.addEventListener('securitypolicyviolation', event => { window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`); });

function Host() {
  const [open, setOpen] = useState(false);
  return <main style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
    <h1 style={{ fontSize: 20 }}>Fictional canvas host</h1>
    {open ? <Suspense fallback={<p role="status">Loading canvas</p>}><CanvasPanel licenseKey={boot.licenseKey} /></Suspense>
      : <button type="button" onClick={() => setOpen(true)}>Open canvas</button>}
  </main>;
}

createRoot(document.getElementById('root')).render(<Host />);
