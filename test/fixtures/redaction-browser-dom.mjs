import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Window } from 'happy-dom';
import { openRedactionBrowser } from '../../examples/redaction-browser/runtime.mjs';
import { createRedactionBrowserHandler } from '../../examples/redaction-browser/server.mjs';
import { createRedactionBrowserClient } from '../../examples/redaction-browser/client.mjs';
import { redactionActor, encode } from '../../examples/redaction/bindings.mjs';
import { fictionalTranscript } from '../../examples/redaction-browser/fixtures.mjs';

const modulePath = process.env.REDACTION_BROWSER_DOM_MODULE ?? '../../dist/redaction-browser-view.js';
test('fictional redaction concrete controllers, mounted dictation and native publication DOM', { timeout: 120000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'redaction-dom-')), window = new Window({ url: 'https://fictional.invalid/' }), globals = new Map();
  let holdPublication = false, releasePublication;
  let transcript = fictionalTranscript, heldView = false, releaseView, holdCaptureAdoption = false, releaseCaptureAdoption, heldLatest = false, releaseLatest, mutateRequest;
  let runtime, session, root, act, revoked = false, failTranscribe = false, holdTranscribe = false, releaseTranscribe, denySave = false, loseSave = false, holdSave = false, releaseSave, loseAdmit = false, loseAdopt = false, denyRetry = false, mutateResult;
  const transmissions = [], admissions = [], correctionRequests = [];
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : typeof window[name] === 'function' && /^[a-z]/.test(name) ? window[name].bind(window) : window[name] });
  }
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(async () => { releasePublication?.(); releaseTranscribe?.(); releaseSave?.(); releaseView?.(); releaseLatest?.(); releaseCaptureAdoption?.(); if (root) await act(async () => root.unmount()); await session?.dispose(); await runtime?.close(); await window.happyDOM.close(); rmSync(directory, { recursive: true, force: true }); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const react = await import('react'); act = react.act; const { createRoot } = await import('react-dom/client');
  const { RedactionBrowser, createRedactionBrowserSession } = await import(modulePath);
  runtime = await openRedactionBrowser({ directory, fixtureOptions: () => ({ beforeAdoptionPublish: async () => { if (holdPublication) { holdPublication = false; await new Promise(resolve => { releasePublication = resolve; }); } } }), policy: (_id, _actor, action) => !(revoked && ['read', 'transcribe'].includes(action)) && !(denySave && action === 'publish'),
    transcribe: async input => { transmissions.push(structuredClone({ consultationId: input.consultationId, requestId: input.requestId, recordingId: input.recordingId })); if (holdTranscribe) { holdTranscribe = false; await new Promise(resolve => { releaseTranscribe = resolve; }); } if (failTranscribe) throw new Error('Fictional recording failed'); return transcript; } });
  const handler = createRedactionBrowserHandler({ runtime, getOrigin: () => 'https://fictional.invalid' });
  const transport = async request => {
    const pathname = new URL(request.url).pathname, input = await request.clone().json();
    if (pathname.endsWith('/admit')) admissions.push(structuredClone(input));
    if (pathname.endsWith('/correct')) correctionRequests.push(structuredClone(input));
    if (holdSave && pathname.endsWith('/notes') && input.kind === 'publish') { holdSave = false; await new Promise(resolve => { releaseSave = resolve; }); }
    const headers = new Headers(request.headers); headers.set('authorization', denyRetry && (pathname.endsWith('/admit') || pathname.endsWith('/adopt')) ? 'Bearer foreign' : 'Bearer fictional-redaction'); headers.set('origin', 'https://fictional.invalid');
    if (holdCaptureAdoption && pathname.endsWith('/capture-adoption')) { holdCaptureAdoption = false; await new Promise(resolve => { releaseCaptureAdoption = resolve; }); }
    if (mutateRequest?.path === pathname) { const mutation = mutateRequest; mutateRequest = null; mutation.change(input); request = new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(input) }); }
    const response = await handler(new Request(request, { headers }));
    if (heldView && pathname.endsWith('/view')) { heldView = false; await new Promise(resolve => { releaseView = resolve; }); }
    if (heldLatest && pathname.endsWith('/latest')) { heldLatest = false; await new Promise(resolve => { releaseLatest = resolve; }); }
    if (loseSave && pathname.endsWith('/notes') && input.kind === 'publish') { loseSave = false; throw new Error('Lost saved acknowledgement'); }
    if (loseAdmit && pathname.endsWith('/admit')) { loseAdmit = false; throw new Error('Lost native acknowledgement'); }
    if (loseAdopt && pathname.endsWith('/adopt')) { loseAdopt = false; throw new Error('Lost adoption acknowledgement'); }
    if (mutateResult?.path === pathname) { const mutation = mutateResult; mutateResult = null; const body = await response.json(); mutation.change(body); return new Response(JSON.stringify(body), { headers: response.headers }); }
    return response;
  };
  const client = createRedactionBrowserClient({ origin: 'https://fictional.invalid', identity: redactionActor(), fetch: transport });
  session = await createRedactionBrowserSession(client); const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(react.createElement(RedactionBrowser, { session })));
  const first = session.consultations.get('first'), second = session.consultations.get('second');
  const button = label => { const found = [...container.querySelectorAll('button')].find(node => node.textContent === label); assert.ok(found, label); return found; };
  const click = label => act(async () => button(label).click());
  const wait = async predicate => { for (let i = 0; i < 500 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); assert.ok(predicate(), 'Expected state reached'); };
  const cursor = (start, end = start) => { const node = container.querySelector('[data-notes] textarea'); assert.ok(node); node.focus(); node.setSelectionRange(start, end); return node; };
  const edit = async text => act(async () => { const node = container.querySelector('[data-notes] textarea'); Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(node, text); node.dispatchEvent(new window.Event('input', { bubbles: true })); });
  const generation = subject => first.blocks[subject];
  const ready = async subject => { for (let i = 0; i < 200 && generation(subject).proposal?.kind !== 'ready'; i++) { await act(async () => session.refreshProposal('first', subject)); await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); } assert.equal(generation(subject).proposal.kind, 'ready'); };
  await wait(() => !!first.mounted?.getTarget());
  assert.equal(first.notes.getSnapshot().dirty, false);
  const original = first.notes.getSnapshot().text; cursor(2, 5); await click('Insert fictional dictation'); await wait(() => first.dictations[0]?.status === 'applied');
  assert.equal(first.notes.getSnapshot().text, original.slice(0, 2) + fictionalTranscript + original.slice(5));
  const applied = first.dictations[0], appliedText = first.notes.getSnapshot().text; await act(async () => session.retryDictation(applied)); assert.equal(first.notes.getSnapshot().text, appliedText); assert.equal(transmissions.length, 1);
  failTranscribe = true; cursor(1); await click('Insert fictional dictation'); await wait(() => first.dictations[1]?.status === 'failed'); const failed = first.dictations[1];
  await click(second.config.title); failTranscribe = false; await act(async () => session.retryDictation(failed)); assert.equal(failed.status, 'retained'); assert.equal(second.notes.getSnapshot().dirty, false); assert.equal(transmissions.at(-1).consultationId, 'first'); assert.equal(transmissions.at(-1).requestId, failed.requestId);
  await click(first.config.title); await wait(() => !!first.mounted?.getTarget());
  holdTranscribe = true; cursor(4); await click('Insert fictional dictation'); await wait(() => !!releaseTranscribe); const typed = first.dictations.at(-1); await edit('Newer typing 🌈'); releaseTranscribe(); releaseTranscribe = null; await wait(() => typed.status === 'retained'); assert.equal(first.notes.getSnapshot().text, 'Newer typing 🌈'); assert.equal(typed.transcript, fictionalTranscript);
  holdTranscribe = true; cursor(2); await click('Insert fictional dictation'); await wait(() => !!releaseTranscribe); const switched = first.dictations.at(-1); await click(second.config.title); await click(first.config.title); releaseTranscribe(); releaseTranscribe = null; await wait(() => switched.status === 'retained'); assert.equal(first.notes.getSnapshot().text, 'Newer typing 🌈');
  holdTranscribe = true; cursor(2); await click('Insert fictional dictation'); await wait(() => !!releaseTranscribe); const remounted = first.dictations.at(-1); await act(async () => root.render(react.createElement('section', null, react.createElement(RedactionBrowser, { session })))); releaseTranscribe(); releaseTranscribe = null; await wait(() => remounted.status === 'retained');
  holdTranscribe = true; cursor(1); await click('Insert fictional dictation'); await wait(() => !!releaseTranscribe); const forbidden = first.dictations.at(-1); revoked = true; releaseTranscribe(); releaseTranscribe = null; await wait(() => forbidden.status === 'failed'); assert.equal(forbidden.transcript, null); revoked = false;
  denySave = true; const countBefore = admissions.length; await click('Generate A/B/C from selected notes'); await wait(() => first.notice.startsWith('No generation')); assert.equal(admissions.length, countBefore); denySave = false;
  loseSave = true; await click('Generate A/B/C from selected notes'); await wait(() => first.notice.includes('unknown')); assert.equal(admissions.length, countBefore);
  await act(async () => first.notes.actions.reconcile()); assert.equal(first.notes.getSnapshot().save.result.kind, 'saved');
  await edit('Acknowledged old selection'); holdSave = true; await click('Generate A/B/C from selected notes'); await wait(() => !!releaseSave); await edit('Newer unsaved selection'); releaseSave(); releaseSave = null;
  await wait(() => admissions.length === countBefore + 3); assert.equal(first.notes.getSnapshot().text, 'Newer unsaved selection'); assert.equal(first.notes.getSnapshot().dirty, true); assert.equal(new Set(admissions.slice(-3).map(request => request.source.revision)).size, 1);
  await ready('A'); await ready('B'); await ready('C');
  for (const subject of ['A', 'B', 'C']) { const produced = await runtime.local.apps.first.local.harness.getTask(generation(subject).ref.producer, context); assert.equal(produced.input.text, 'Acknowledged old selection'); }
  const proposal = generation('A').proposal, item = proposal.value.items[0];
  const beforeInvalidCorrection = correctionRequests.length;
  for (const invalid of ['x'.repeat(40000), '\uD800']) { let result; await act(async () => { result = await session.correct('A', item.itemId, invalid); }); assert.equal(result.kind, 'denied'); assert.equal(generation('A').correction.result.kind, 'denied'); assert.equal(correctionRequests.length, beforeInvalidCorrection); assert.ok(container.querySelector('[data-block=A]').textContent.includes('denied')); }
  await act(async () => session.choose('A', item.itemId, '\uD800')); let unpreparedAdoption; await act(async () => { unpreparedAdoption = await session.adopt('A'); }); assert.equal(unpreparedAdoption.kind, 'denied'); assert.equal(generation('A').adopting, null); assert.equal(generation('A').adoption, null); await act(async () => session.choose('A', item.itemId, 'proposed'));
  await act(async () => session.correct('A', item.itemId, 'Fictional human correction')); assert.equal(generation('A').correction.result.kind, 'committed');
  await act(async () => session.choose('A', item.itemId, 'corrected'));
  await click('Adopt selected A'); await wait(() => !!generation('A').adoption?.ref);
  for (let i = 0; i < 200 && generation('A').adoption.result.kind !== 'committed'; i++) { await act(async () => session.adoptionResult('first', 'A')); await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
  assert.equal(generation('A').adoption.result.kind, 'committed'); assert.ok(container.querySelector('[data-block=A] [data-adopted]').textContent.includes('Fictional human correction'));
  const savedRecord = generation('A').record.snapshot.ref, savedRecordText = new TextDecoder().decode(generation('A').record.snapshot.bytes);
  await act(async () => generation('A').letter.actions.edit('Independent unsaved letter')); assert.equal(button('Adopt selected A').disabled, true); const previousAdoption = generation('A').adoption; await act(async () => session.adopt('A')); assert.equal(generation('A').adoption, previousAdoption);
  await act(async () => generation('A').letter.actions.discardToRemote());
  const reviewed = generation('A').proposal.corrections.find(slot => slot.itemId === item.itemId);
  const concurrent = await runtime.correct('first', { ref: generation('A').ref, options: { requestId: 'concurrent-correction', itemId: item.itemId, expected: reviewed.expected, text: 'New unseen correction' } }, redactionActor()); assert.equal(concurrent.kind, 'committed');
  await click('Adopt selected A'); await wait(() => generation('A').outcome.kind === 'conflict'); assert.equal(generation('A').record.snapshot.ref.revision, savedRecord.revision);
  await act(async () => session.refreshProposal('first', 'A'));
  loseAdmit = true; await click('Generate B'); await wait(() => generation('B').outcome.kind === 'unknown'); const retained = structuredClone(generation('B').request); denyRetry = true; await click('Retry original B'); assert.equal(generation('B').outcome.kind, 'unknown'); denyRetry = false; await click('Retry original B'); await wait(() => generation('B').outcome.kind === 'admitted'); assert.equal(generation('B').outcome.kind, 'admitted'); assert.deepEqual(generation('B').request, retained); await ready('B');
  loseAdopt = true; await click('Adopt selected B'); await wait(() => generation('B').adoption?.result?.kind === 'unknown'); const retainedAdoption = structuredClone(generation('B').adoption.request); denyRetry = true; await click('Retry adoption B'); assert.equal(generation('B').adoption.result.kind, 'unknown'); denyRetry = false; await click('Retry adoption B'); await wait(() => generation('B').adoption.result.kind === 'admitted'); assert.deepEqual(generation('B').adoption.request, retainedAdoption); assert.equal(generation('B').adoption.result.kind, 'admitted');
  for (let i = 0; i < 100 && generation('B').adoption.result.kind !== 'committed'; i++) { await act(async () => session.adoptionResult('first', 'B')); await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
  mutateResult = { path: '/consultations/first/adoption-result', change: value => { value.receipt.principalId = 'foreign-owner'; } }; await act(async () => session.adoptionResult('first', 'B')); assert.equal(generation('B').adoption.result.kind, 'unknown'); await act(async () => session.adoptionResult('first', 'B')); assert.equal(generation('B').adoption.result.kind, 'committed');
  const admissionsBeforeReload = admissions.length; await click('Observe latest'); assert.equal(admissions.length, admissionsBeforeReload); assert.equal(generation('A').record.snapshot.ref.revision, savedRecord.revision); assert.equal(new TextDecoder().decode(generation('A').record.snapshot.bytes), savedRecordText);
  transcript = '\uFEFFHello 🌞'; await wait(() => !!first.mounted?.getTarget()); cursor(0); const unicodeBefore = first.notes.getSnapshot().text; await click('Insert fictional dictation'); await wait(() => first.dictations.at(-1).status === 'applied'); assert.equal(first.notes.getSnapshot().text, transcript + unicodeBefore); transcript = fictionalTranscript;
  holdCaptureAdoption = true; let heldAdoption; await act(async () => { heldAdoption = session.adopt('C'); }); await wait(() => !!releaseCaptureAdoption); const oldCAdoption = generation('C').adoption; await act(async () => generation('C').letter.actions.edit('Typed while adoption capture waited')); releaseCaptureAdoption(); releaseCaptureAdoption = null; await act(async () => heldAdoption); assert.equal(generation('C').outcome.kind, 'conflict'); assert.equal(generation('C').adoption, oldCAdoption); assert.equal(generation('C').letter.getSnapshot().text, 'Typed while adoption capture waited');
  heldView = true; let oldView; await act(async () => { oldView = session.refreshProposal('first', 'A'); }); await wait(() => !!releaseView); const oldRef = generation('A').ref; await click('Generate A'); await wait(() => generation('A').ref && generation('A').ref !== oldRef); const newRef = generation('A').ref; releaseView(); releaseView = null; await act(async () => oldView); assert.equal(generation('A').ref, newRef); await ready('A');
  heldLatest = true; let oldLatest; await act(async () => { oldLatest = session.reload('first'); }); await wait(() => !!releaseLatest); await click('Generate A'); await wait(() => generation('A').ref && generation('A').ref !== newRef); const newestRef = generation('A').ref; releaseLatest(); releaseLatest = null; await act(async () => oldLatest); assert.equal(generation('A').ref, newestRef); await ready('A');
  loseAdmit = true; await click('Generate A'); await wait(() => generation('A').outcome.kind === 'unknown'); const uncertainRequest = generation('A').request, blockedCount = admissions.length; await click('Generate A'); assert.equal(admissions.length, blockedCount); assert.equal(generation('A').request, uncertainRequest); await click('Retry original A'); await wait(() => generation('A').outcome.kind === 'admitted'); await ready('A');
  const lastItem = generation('A').proposal.value.items[0]; mutateRequest = { path: '/consultations/first/correct', change: input => { input.options.text = 'Substituted valid text'; } }; await act(async () => session.correct('A', lastItem.itemId, 'Intended human text')); assert.equal(generation('A').correction.result.kind, 'unknown'); const unchangedView = await runtime.view('first', generation('A').ref, redactionActor()); assert.equal(unchangedView.corrections.find(slot => slot.itemId === lastItem.itemId).value.text, 'New unseen correction'); await act(async () => session.retryCorrection('first', 'A')); assert.equal(generation('A').correction.result.kind, 'committed');
  mutateRequest = { path: '/consultations/first/capture-adoption', change: input => { input.choices.reverse(); input.corrections.reverse(); } }; await act(async () => session.adopt('A')); assert.equal(generation('A').outcome.kind, 'unavailable');
  heldView = true; let oldCorrectionView; await act(async () => { oldCorrectionView = session.refreshProposal('first', 'A'); }); await wait(() => !!releaseView); await act(async () => session.correct('A', lastItem.itemId, 'Newest displayed correction C2')); assert.equal(generation('A').correction.result.kind, 'committed'); releaseView(); releaseView = null; await act(async () => oldCorrectionView); assert.equal(generation('A').proposal.corrections.find(slot => slot.itemId === lastItem.itemId).value.text, 'Newest displayed correction C2'); await act(async () => session.choose('A', lastItem.itemId, 'corrected')); await act(async () => session.adopt('A')); assert.equal(generation('A').adoption.result.kind, 'admitted');
  for (let i = 0; i < 100 && generation('A').adoption.result.kind !== 'committed'; i++) { await act(async () => session.adoptionResult('first', 'A')); await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); } assert.equal(generation('A').adoption.result.kind, 'committed'); assert.ok(new TextDecoder().decode(generation('A').record.snapshot.bytes).includes('Newest displayed correction C2'));
  await click(second.config.title); await click('Generate C'); await wait(() => second.blocks.C.outcome?.kind === 'admitted');
  for (let i = 0; i < 100 && second.blocks.C.proposal?.kind !== 'ready'; i++) { await act(async () => session.refreshProposal('second', 'C')); await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); } assert.equal(second.blocks.C.proposal.kind, 'ready');
  holdPublication = true; await click('Adopt selected C'); await wait(() => !!releasePublication); const lateTarget = second.config.letters.C;
  const humanLetter = await runtime.resourceClient('second', 'letter-C', redactionActor()).publish({ operationId: 'human-during-native-adoption', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: lateTarget, expected: { kind: 'absent' }, bytes: encode('Independent human C letter'), mediaType: 'text/markdown' }] }); assert.equal(humanLetter.kind, 'committed'); releasePublication(); releasePublication = null;
  for (let i = 0; i < 100 && second.blocks.C.adoption.result.kind !== 'conflict'; i++) { await act(async () => session.adoptionResult('second', 'C')); await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); } assert.equal(second.blocks.C.adoption.result.kind, 'conflict');
  const humanRead = await second.api.letters.C.read({ target: lateTarget, revision: { kind: 'latest' } }); assert.equal(new TextDecoder().decode(humanRead.snapshot.bytes), 'Independent human C letter'); const afterConflictCount = admissions.length; await click('Generate C'); await wait(() => admissions.length === afterConflictCount + 1); assert.equal(second.blocks.C.adoption, null); await click(first.config.title);
  const crossed = await second.api.admit(generation('A').request); assert.equal(crossed.kind, 'denied');
  await act(async () => root.unmount()); root = null;
  const observed = await runtime.latest('first', 'A', redactionActor()); assert.equal(observed.kind, 'admitted'); assert.equal(observed.ref.validation, generation('A').ref.validation);
});
