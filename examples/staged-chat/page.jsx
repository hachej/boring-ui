import { createElement as h, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { PiChat } from '../../registry/pi-chat/pi-chat';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

const question = 'Quelle dose pour un adulte ?';
window.__STAGED__ = { copies: [], controllers: {} };
function Thread({ name }) {
  const [controller, setController] = useState(), [reader, setReader] = useState({ seen: [], offers: 0 });
  useEffect(() => {
    let disposed = false, remote, owned;
    void (async () => {
      remote = await createRemoteChat({ endpoint: new URL(`/chat?thread=${name}`, location.href), fetch: request => fetch(request), pollMs: 100 });
      owned = createNativeChatController({ ...remote, identity: { runtimeId: 'fictional-triage', scopeId: name, principalId: 'fictional-reader' }, restoreOnError: true });
      if (disposed) { await owned.dispose(); await remote.close(); return; }
      setReader(await (await fetch(`/state?thread=${name}`)).json());
      window.__STAGED__.controllers[name] = owned; setController(owned);
    })();
    return () => { disposed = true; void owned?.dispose(); void remote?.close(); delete window.__STAGED__.controllers[name]; };
  }, [name]);
  const act = async (action, key) => setReader(await (await fetch(`/action?thread=${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, key }) })).json());
  const fail = number => void controller.send('followUp', { text: `${question}\nÉCHEC ${number}`, restore: { text: question } });
  return <section data-thread={name} className="flex h-[44rem] min-h-0 min-w-0 flex-col">
    <div className="flex flex-wrap items-center gap-2 pb-2"><h2 className="m-0 flex-1">{name}</h2><Badge variant="secondary" data-testid="offer-count">{reader.offers} offres utilisées</Badge>
      <Button variant="outline" size="sm" disabled={!controller} data-testid="fail-first" onClick={() => fail(1)}>Échec étape 1</Button>
      <Button variant="outline" size="sm" disabled={!controller} data-testid="fail-second" onClick={() => fail(2)}>Échec étape 2</Button>
    </div>
    {controller ? <PiChat controller={controller} conversationTitle={name} locale="fr" presentation="natural" displayLimit={24} historicalMessageActions
      hideLine={line => line.startsWith('::meta ')}
      renderEntry={entry => entry.kind === 'fictional.triage.stage' ? { inline: true, status: entry.data.state === 'running' ? `Validation de l’étape ${entry.data.stage}…` : null,
        content: entry.data.state === 'failed' ? <Alert variant="destructive"><AlertDescription>La prochaine étape a échoué. La note précédente reste disponible.</AlertDescription></Alert> : <Badge variant="outline">Étape {entry.data.stage} : {entry.data.state === 'validated' ? 'validée' : 'en cours'}</Badge> } : undefined}
      onCopy={async text => { window.__STAGED__.copies.push(text); }}
      messageActions={reply => [{ id: 'offer', label: 'Utiliser cette note fictive', onSelect: () => { void act('offer', reply.key); } }]}
      unread={reply => !reader.seen.includes(reply.entryId ?? reply.key) ? <Button variant="ghost" size="sm" data-testid="unread" aria-label="Marquer cette réponse comme lue" onClick={() => { void act('seen', reply.entryId ?? reply.key); }}><Badge variant="secondary">● Non lu</Badge></Button> : null}
      replyFooter={reply => <span data-testid="total-duration">Total des tours : {reply.durationMs ?? 'inconnu'} ms</span>} /> : <p>Connexion…</p>}
  </section>;
}
function App() { return <main className="box-border grid min-h-screen grid-cols-1 gap-4 p-4 lg:grid-cols-2"><Thread name="Questions" /><Thread name="Senior" /></main>; }
createRoot(document.getElementById('root')).render(h(App));
