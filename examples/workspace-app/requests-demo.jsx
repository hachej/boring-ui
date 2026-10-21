import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RequestsBoard } from '../../registry/requests-board/requests-board';
import { inboxViews, requestViews } from './requests-fixture.mjs';

/** `?requests`: a standalone host-fed board; no app-shell context, agent or request endpoint is needed by the block. */
export function RequestsDemo() {
  const [views, setViews] = useState(inboxViews);
  const [mode, setMode] = useState('compact');
  const [locale, setLocale] = useState('fr');
  const [token, setToken] = useState(0);
  const [release, setRelease] = useState(false);
  const [log, setLog] = useState('');
  const moved = () => { setViews(current => current.map(view => view.number === 'D-903' ? { ...view, state: 'try', action: { kind: 'preview', href: 'https://atelier-exemple.invalid/preview' } } : view)); setToken(current => current + 1); };
  return <main className="boring-viewer flex h-full min-h-0 flex-col" data-testid="requests-demo">
    <header className="flex flex-wrap items-center gap-2 p-4">
      <span>Atelier Exemple</span>
      <Button variant="outline" onClick={() => setMode(current => current === 'compact' ? 'full' : 'compact')}>{mode === 'compact' ? 'Full' : 'Compact'}</Button>
      <Button variant="outline" onClick={() => setLocale(current => current === 'fr' ? 'en' : 'fr')}>FR / EN</Button>
      <Button variant="outline" onClick={moved}>D-903 → À essayer</Button>
      <Button variant="outline" aria-pressed={release} onClick={() => { setRelease(current => !current); setViews(current => current.map(view => view.number === 'D-906' ? requestViews[5] : view)); }}>Release permission</Button>
    </header>
    <div className="min-h-0 min-w-0 flex-1"><RequestsBoard views={views} mode={mode} locale={locale} changeToken={token} canApproveRelease={release}
      repos={['Atelier Exemple', 'Atelier Exemple — vitrine']} onOpenAll={() => { setMode('full'); setLog('all'); }} onOpen={id => setLog(`open ${id}`)}
      onAnswer={(id, answer) => setLog(`answer ${id} ${answer}`)} onDecide={(id, decision) => setLog(`decide ${id} ${decision}`)} onTry={(id, action) => setLog(`try ${id} ${action.kind}`)} /></div>
    <output data-testid="requests-log" className="sr-only">{log}</output>
  </main>;
}
