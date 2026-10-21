import { createElement as h, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { PiChat } from '../../registry/pi-chat/pi-chat';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { demoLabels, stageProjection } from './presentation.mjs';

const question = 'Quelle dose pour un adulte ?';
const locale = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'fr';
const labels = demoLabels(locale);
window.__STAGED__ = { copies: [], controllers: {} };
function Thread({ name }) {
  const [controller, setController] = useState(), [reader, setReader] = useState({ seen: [], offers: 0 });
  const failure = useRef(0);
  useEffect(() => {
    let disposed = false, remote, owned;
    const failures = new WeakMap();
    void (async () => {
      remote = await createRemoteChat({ endpoint: new URL(`/chat?thread=${name}`, location.href), fetch: request => fetch(request), pollMs: 100, requestContext: () => {
        const send = owned?.getSnapshot().send;
        return { failAt: send?.kind === 'submitting' ? failures.get(send.attempt.draft) ?? 0 : 0 };
      } });
      owned = createNativeChatController({ ...remote, identity: { runtimeId: 'fictional-triage', scopeId: name, principalId: 'fictional-reader' }, restoreOnError: true,
        beforeSubmit: async draft => { if (!failures.has(draft)) failures.set(draft, failure.current); } });
      if (disposed) { await owned.dispose(); await remote.close(); return; }
      setReader(await (await fetch(`/state?thread=${name}`)).json());
      window.__STAGED__.controllers[name] = owned; setController(owned);
    })();
    return () => { disposed = true; void owned?.dispose(); void remote?.close(); delete window.__STAGED__.controllers[name]; };
  }, [name]);
  const act = async (action, key) => setReader(await (await fetch(`/action?thread=${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, key }) })).json());
  const fail = async number => {
    failure.current = number;
    try { await controller.send('followUp', { text: question, restore: { text: question } }); }
    finally { failure.current = 0; }
  };
  return <section data-thread={name} className="flex h-[44rem] min-h-0 min-w-0 flex-col">
    {controller ? <Conversation name={name} controller={controller} reader={reader} act={act} fail={fail} /> : <p>Connexion…</p>}
  </section>;
}
function Conversation({ name, controller, reader, act, fail }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const entries = [...(snapshot.history.kind === 'ready' ? snapshot.history.entries : []), ...(snapshot.view?.entries ?? [])];
  const projection = stageProjection(entries);
  const busy = Boolean(snapshot.view?.docs['pi.live']?.run) || ['validating', 'submitting', 'unknown'].includes(snapshot.send.kind);
  return <>
    <div className="flex flex-wrap items-center gap-2 pb-2"><Badge variant="secondary" data-testid="offer-count">{labels.offers(reader.offers)}</Badge>
      <Button variant="outline" size="sm" disabled={busy} data-testid="fail-first" onClick={() => { void fail(1); }}>{labels.failButton(1)}</Button>
      <Button variant="outline" size="sm" disabled={busy} data-testid="fail-second" onClick={() => { void fail(2); }}>{labels.failButton(2)}</Button>
    </div>
    <PiChat controller={controller} conversationTitle={name} locale={locale} presentation="natural" displayLimit={24} historicalMessageActions
      hideLine={line => line.startsWith('::meta ')}
      renderEntry={entry => {
        const stage = projection.cards.get(entry.id);
        return stage ? { inline: true, status: stage.state === 'running' ? labels.preparing(stage.stage) : null,
          content: <Badge variant="outline" data-testid="stage-status" data-task={stage.taskId} data-stage={stage.stage} data-state={stage.state}>{labels.stage(stage.stage, stage.state)}</Badge> } : undefined;
      }}
      replyError={reply => { const stage = projection.errors.get(reply.entryId); return stage === undefined ? undefined : labels.failure(stage); }}
      onCopy={async text => { window.__STAGED__.copies.push(text); }}
      messageActions={reply => [{ id: 'offer', label: labels.offer, onSelect: () => { void act('offer', reply.key); } }]}
      unread={reply => !reader.seen.includes(reply.entryId ?? reply.key) ? <Button variant="ghost" size="sm" data-testid="unread" aria-label={labels.markSeen} onClick={() => { void act('seen', reply.entryId ?? reply.key); }}><Badge variant="secondary">● {labels.unread}</Badge></Button> : null}
      replyFooter={reply => { const duration = labels.duration(reply.durationMs); return duration ? <span data-testid="total-duration">{duration}</span> : null; }} />
  </>;
}
function App() { return <main className="box-border grid min-h-screen grid-cols-1 gap-4 p-4 lg:grid-cols-2"><Thread name="Questions" /><Thread name="Senior" /></main>; }
createRoot(document.getElementById('root')).render(h(App));
