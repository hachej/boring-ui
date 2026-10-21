import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { createResourceClient } from '@hachej/boring-files/remote';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { Highlights } from '../../registry/highlights/highlights';

const { token, identity, target } = JSON.parse(document.getElementById('boot')!.textContent!);
const authorized: typeof fetch = (input, init) => { const request = new Request(input, init); const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${token}`); return fetch(new Request(request, { headers })); };
const client = createResourceClient({ identity: { runtimeId: 'highlights', ...identity }, endpoint: new URL('/api/resources', location.href), publication: true, reconciliation: true, fetch: authorized });
const resource = { client, identity };
function App() {
  const [controller, setController] = useState<ReturnType<typeof createMarkdownController> | null>(null);
  const locale = new URLSearchParams(location.search).get('locale') === 'fr' ? 'fr' : 'en';
  useEffect(() => {
    let active = true, acquired: ReturnType<typeof createMarkdownController> | undefined;
    void client.read({ target, revision: { kind: 'latest' } }).then(read => {
      if (read.kind !== 'available') throw Error('Fictional document unavailable');
      acquired = createMarkdownController({ source: { kind: 'saved', snapshot: read.snapshot }, client, identity, instanceId: 'highlights-page', epoch: 'one' });
      if (active) setController(acquired); else acquired.dispose();
    });
    return () => { active = false; acquired?.dispose(); };
  }, []);
  return <main className="boring-viewer mx-auto flex min-h-dvh min-w-0 max-w-3xl flex-col gap-4 p-4">
    <h1>{locale === 'fr' ? 'Carnet fictif' : 'Fictional field notebook'}</h1>
    <p>{locale === 'fr' ? 'Surlignez un passage, commentez-le ou retrouvez une annotation perdue.' : 'Highlight a passage, comment on it, or find a misplaced annotation.'}</p>
    {controller && <Highlights controller={controller} resource={resource} locator={target} locale={locale} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
