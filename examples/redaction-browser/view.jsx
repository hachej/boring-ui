import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { PreparationExperience } from './preparation-view.jsx';
import { MarkdownEditor } from '@hachej/boring-ui-kit/markdown-editor';
import { createRedactionBrowserClient } from './client.mjs';
import { createRedactionBrowserSession, hasLetterDraft } from './session.mjs';
export { createRedactionBrowserSession } from './session.mjs';

function Result({ result }) {
  if (!result) return null;
  return <div><output role="status">{result.kind}{result.reason ? `: ${result.reason}` : ''}</output>{result.kind === 'committed' && <code data-receipt>{result.receipt.operationId}</code>}</div>;
}
function Item({ session, block, item }) {
  const [draft, setDraft] = useState('');
  const corrected = block.proposal.corrections.find(slot => slot.itemId === item.itemId)?.value;
  return <li data-item={item.itemId}><h3>Proposed item</h3><p data-proposed>{item.text}</p>
    {corrected && <><h3>Saved correction</h3><p data-corrected>{corrected.text}</p></>}
    <label>Correction text<input aria-label={`Correction ${block.subject} ${item.itemId}`} value={draft} onChange={event => setDraft(event.target.value)} /></label>
    <button disabled={!draft} onClick={() => void session.correct(block.subject, item.itemId, draft)}>Save correction {block.subject}</button>
    <label>Adoption choice<select aria-label={`Choice ${block.subject} ${item.itemId}`} value={block.choices[item.itemId] ?? 'proposed'} onChange={event => session.choose(block.subject, item.itemId, event.target.value)}><option value="proposed">Proposed</option><option value="corrected" disabled={!corrected}>Corrected</option></select></label>
  </li>;
}
function Block({ session, owner, block }) {
  const letter = useSyncExternalStore(block.letter.subscribe, block.letter.getSnapshot, block.letter.getSnapshot);
  let savedRecord;
  if (block.record.kind === 'available') {
    try { savedRecord = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(block.record.snapshot.bytes)); }
    catch { savedRecord = null; }
  }
  return <article data-block={block.subject}><h2>Block {block.subject}</h2><Result result={block.outcome} />
    <button onClick={() => void session.generate([block.subject])}>Generate {block.subject}</button>
    {block.request && ['unknown', 'reserved'].includes(block.outcome?.kind) && <button onClick={() => void session.retryAdmission(owner.config.id, block.subject)}>Retry original {block.subject}</button>}
    {block.ref && <button onClick={() => void session.refreshProposal(owner.config.id, block.subject)}>Refresh proposal {block.subject}</button>}
    {block.proposal?.kind === 'ready' ? <ol>{block.proposal.value.items.map(item => <Item key={`${block.ref.validation}:${item.itemId}`} session={session} block={block} item={item} />)}</ol> : <Result result={block.proposal} />}
    <Result result={block.correction?.result} />
    {block.correction?.result?.kind === 'unknown' && <button onClick={() => void session.retryCorrection(owner.config.id, block.subject)}>Retry correction {block.subject}</button>}
    <button disabled={block.adopting || block.adoption?.result === null || ['unknown', 'admitted', 'pending'].includes(block.adoption?.result?.kind) || block.proposal?.kind !== 'ready' || hasLetterDraft(letter) || letter.save.kind === 'pending' || letter.save.kind === 'settled' && letter.save.result.kind === 'unknown'} onClick={() => void session.adopt(block.subject)}>Adopt selected {block.subject}</button>
    <Result result={block.adoption?.result} />
    {block.adoption?.result?.kind === 'unknown' && <button onClick={() => void session.retryAdoption(owner.config.id, block.subject)}>Retry adoption {block.subject}</button>}
    {block.adoption?.ref && <button onClick={() => void session.adoptionResult(owner.config.id, block.subject)}>Check adoption {block.subject}</button>}
    <section data-adopted><h3>Saved record</h3>{savedRecord ? <><code data-record-revision>{block.record.snapshot.ref.revision}</code><ul>{savedRecord.items.map(item => <li key={item.itemId}>{item.text} ({item.kind})</li>)}</ul></> : <p>{block.record.kind === 'missing' ? 'No adopted record' : 'Saved record unavailable'}</p>}</section>
    <div data-letter={block.subject}><MarkdownEditor controller={block.letter} initialMode="source" title={`Letter ${block.subject}`} /></div>
  </article>;
}
export function RedactionBrowser({ session }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot), owner = state.consultations.find(value => value.config.id === state.active);
  const mounted = useCallback(tools => session.mounted(owner.config.id, tools), [session, owner]);
  const [error, setError] = useState('');
  const run = action => { setError(''); Promise.resolve().then(action).catch(reason => setError(String(reason))); };
  useEffect(() => { setError(''); }, [owner]);
  return <main data-boring="redaction-browser"><h1>Fictional consultation workspace</h1><p>No microphone or real clinical data. Scripted proposals and recordings only.</p>
    <nav>{state.consultations.map(value => <button key={value.config.id} aria-pressed={state.active === value.config.id} onClick={() => session.switch(value.config.id)}>{value.config.title}</button>)}</nav>
    <h2>{owner.config.title}</h2><output role="status" data-notice>{owner.notice}</output>{error && <p role="alert">{error}</p>}
    <PreparationExperience key={owner.config.id} owner={owner} notes={<div data-notes><MarkdownEditor key={`${owner.config.id}:${state.page}`} controller={owner.notes} initialMode="source" title="Consultation notes" onMountedTools={mounted} /></div>} actions={<div data-fixed-actions><button onClick={() => run(() => session.generate())}>Generate A/B/C from selected notes</button><button onClick={() => run(() => session.reload())}>Observe latest</button><button onClick={() => run(() => session.dictate())}>Insert fictional dictation</button></div>} />
    <section data-dictations>{owner.dictations.map(capture => <article key={capture.requestId} data-dictation={capture.requestId}><output role="status">{capture.status}: {capture.reason ?? 'Original consultation and cursor retained'}</output>{capture.transcript !== null && <pre data-transcript>{capture.transcript}</pre>}{capture.status === 'failed' && <button onClick={() => run(() => session.retryDictation(capture))}>Retry original recording</button>}</article>)}</section>
    <div data-blocks>{Object.values(owner.blocks).map(block => <Block key={`${owner.config.id}:${block.subject}`} session={session} owner={owner} block={block} />)}</div>
  </main>;
}
if (typeof document !== 'undefined' && document.querySelector('[data-redaction-root]')) {
  const transport = async request => { const headers = new Headers(request.headers); headers.set('authorization', 'Bearer fictional-redaction'); return fetch(new Request(request, { headers })); };
  const identity = { principalId: 'fictional-editor', initiatorId: 'fictional-human', scopeId: 'fictional-team' };
  const client = createRedactionBrowserClient({ origin: location.origin, identity, fetch: transport });
  createRedactionBrowserSession(client).then(session => {
    const root = createRoot(document.querySelector('[data-redaction-root]')); root.render(<RedactionBrowser session={session} />);
    window.redaction = { session, inspect: session.getSnapshot, unmount: () => root.unmount() };
  }).catch(error => { document.querySelector('[data-redaction-root]').textContent = `Fictional workspace unavailable: ${error.message}`; });
}
