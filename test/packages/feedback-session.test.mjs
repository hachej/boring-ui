import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { parseFeedback } from '@hachej/boring-feedback/format';
import { createPicker, createPrivacyPolicy, runPrivacyCanaries } from '@hachej/boring-feedback/page';
import { createFeedbackSession, pinMark } from '@hachej/boring-feedback/ui';

// The feedback session (FEEDBACK.md, "UX") on fictional HappyDOM pages. HappyDOM has no layout, so the session gets a hit test that
// names the element "under the pointer", and a controllable clock.
const root = fileURLToPath(new URL('../../', import.meta.url));
const policy = createPrivacyPolicy({ routeOf: ({ pathname }) => pathname.startsWith('/settings/') ? '/settings/:section' : pathname });
const PAGE = `<div id="app"><header data-feedback-visible=""><nav><a href="/settings/billing" id="billing-link" data-testid="billing-link">Billing</a></nav></header>
  <main data-feedback-visible=""><form id="profile"><button type="submit" id="save" data-feedback-id="save-profile">Save profile</button>
  <button type="button" id="plan" data-feedback-id="change-plan">Change plan</button><input id="name" value="Fictional Studio Secret"></form>
  <h2 id="heading">Notifications</h2><section id="data"><p id="secret">Private fictional row</p></section></main></div>
  <div id="ui" data-feedback-ignore=""></div>`;

function page(t, html = PAGE, url = 'https://fictional.invalid/settings/profile?q=hidden#frag') {
  const window = new Window({ url, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  window.document.body.innerHTML = html;
  t.after(() => window.happyDOM.close());
  const { document } = window;
  return { window, document, root: document.getElementById('app'), $: id => document.getElementById(id) };
}

/** A session over the page with a hit test (`under.current`) and a clock (`clock.t`, ms). */
function sessionOn(t, context, options = {}) {
  const under = { current: [] };
  const clock = { t: 1000 };
  const session = createFeedbackSession({ app: 'fictional-settings', build: 'dev-fixture', root: context.root, policy, hitTest: () => under.current, now: () => clock.t, ...options });
  t.after(() => session.dispose());
  return { session, under, clock };
}

const mouse = (window, type, target, init = {}) => target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: 10, clientY: 10, detail: 1, ...init }));
const pointer = (window, type, target, init = {}) => target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: 10, clientY: 10, pointerType: 'mouse', ...init }));
const keydown = (window, target, key, init = {}) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true, ...init }));
const keyup = (window, target, key) => target.dispatchEvent(new window.KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, composed: true }));
const press = (window, target) => { for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) (type.startsWith('pointer') ? pointer : mouse)(window, type, target); mouse(window, 'click', target); };
/** Hover `element` (through the hit test), then click it. */
function pinAt(context, under, element) {
  under.current = [element];
  pointer(context.window, 'pointermove', context.document.body);
  press(context.window, element);
}
const drawnLabels = overlayHost => [...overlayHost.shadowRoot.querySelectorAll('.label')].map(label => ({ label: label.textContent, tone: label.dataset.tone }));
const overlays = document => [...document.querySelectorAll('[data-feedback-overlay]')];
const allDrawn = document => overlays(document).flatMap(drawnLabels);

test('picker options for the session: continuous picking, wheel left to the page, keys inside ignored subtrees, suspend', t => {
  const context = page(t);
  const picked = [];
  const under = { current: [] };
  const picker = createPicker({ root: context.root, policy, hitTest: () => under.current, onPick: element => picked.push(element), wheel: false, keys: 'outside-ignored' });
  t.after(() => picker.dispose());
  void picker.start();
  under.current = [context.$('save')];
  pointer(context.window, 'pointermove', context.document.body);
  press(context.window, context.$('save'));
  under.current = [context.$('plan')];
  pointer(context.window, 'pointermove', context.document.body);
  press(context.window, context.$('plan'));
  assert.deepEqual(picked, [context.$('save'), context.$('plan')]);
  assert.equal(picker.state().mode, 'picking', 'continuous: pick mode stays on');
  const wheel = new context.window.WheelEvent('wheel', { deltaY: -40, bubbles: true, cancelable: true });
  context.document.body.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, false, 'the page scrolls');
  const typed = [];
  context.$('ui').addEventListener('keydown', event => typed.push(event.key));
  keydown(context.window, context.$('ui'), 'x');
  keydown(context.window, context.document.body, 'y');
  assert.deepEqual(typed, ['x'], 'keys inside an ignored subtree reach it; elsewhere they stay the picker\'s');
  const clicks = [];
  context.$('save').addEventListener('click', () => clicks.push('save'));
  picker.suspend(true);
  assert.equal(picker.state().suspended, true);
  press(context.window, context.$('save'));
  assert.deepEqual(clicks, ['save'], 'suspended: the click reaches the page');
  assert.equal(picked.length, 2);
  picker.suspend(false);
  press(context.window, context.$('save'));
  assert.deepEqual(clicks, ['save'], 'resumed: the click is the picker\'s again');
});

test('session state machine: start, pin with a bubble (Enter saves, Esc discards), reopen a pin, Done, review, discard', async t => {
  const context = page(t);
  const { session, under, clock } = sessionOn(t, context);
  assert.equal(session.getSnapshot().phase, 'idle');
  session.start();
  assert.equal(session.getSnapshot().phase, 'active');
  assert.equal(session.getSnapshot().route, '/settings/:section');

  under.current = [context.$('save')];
  pointer(context.window, 'pointermove', context.document.body);
  assert.equal(session.getSnapshot().hover, 'button «Save profile»');
  clock.t = 2000;
  press(context.window, context.$('save'));
  let state = session.getSnapshot();
  assert.equal(state.bubble.number, 1);
  assert.equal(state.bubble.fresh, true);
  assert.equal(state.bubble.label, 'button «Save profile»');
  session.setBubbleText('It should say what it saves.');
  session.saveBubble();
  state = session.getSnapshot();
  assert.equal(state.bubble, undefined);
  assert.deepEqual(state.notes.map(note => [note.number, note.text, note.label]), [[1, 'It should say what it saves.', 'button «Save profile»']]);
  assert.ok(allDrawn(context.document).some(item => item.label === pinMark(1) && item.tone === 'pinned'), 'the pin stays drawn, numbered');

  // A second pin dismissed with Esc (cancelBubble) leaves no note and no pin.
  clock.t = 3000;
  pinAt(context, under, context.$('heading'));
  assert.equal(session.getSnapshot().bubble.number, 2);
  session.cancelBubble();
  assert.equal(session.getSnapshot().notes.length, 1);
  assert.equal(allDrawn(context.document).filter(item => item.tone === 'pinned').length, 1);
  // An empty new note is no note either.
  pinAt(context, under, context.$('heading'));
  session.saveBubble();
  assert.equal(session.getSnapshot().notes.length, 1);
  // Clicking a pinned element reopens its note; Esc keeps it as it was.
  pinAt(context, under, context.$('save'));
  assert.equal(session.getSnapshot().bubble.fresh, false);
  session.setBubbleText('changed');
  session.cancelBubble();
  assert.equal(session.getSnapshot().notes[0].text, 'It should say what it saves.');
  // Esc on the page (not in the bubble) never ends feedback mode.
  keydown(context.window, context.document.body, 'Escape');
  assert.equal(session.getSnapshot().phase, 'active');

  await session.done();
  state = session.getSnapshot();
  assert.equal(state.phase, 'review');
  assert.deepEqual(overlays(context.document).flatMap(drawnLabels), [], 'pins are cleared when feedback mode closes');
  assert.equal(state.route, '/settings/:section');
  const draft = session.draft();
  assert.equal(draft.anchors.length, 1);
  assert.equal(draft.anchors[0].signals.feedbackId, 'save-profile');
  assert.deepEqual(draft.notes, [{ text: 'It should say what it saves.', anchor: 0 }]);
  assert.deepEqual(draft.steps, [{ kind: 'route', route: '/settings/:section' }, { kind: 'note', note: 0 }]);
  assert.equal(draft.said, '');
  const parsed = parseFeedback(new TextEncoder().encode(session.reportText()));
  assert.equal(parsed.ok, true, JSON.stringify(parsed.problems));
  assert.ok(!session.reportText().includes('q=hidden') && !session.reportText().includes('Fictional Studio Secret'));

  session.discard();
  assert.equal(session.getSnapshot().phase, 'idle');
  assert.throws(() => session.draft());
  // Done with nothing said goes back to idle.
  session.start();
  await session.done();
  assert.equal(session.getSnapshot().phase, 'idle');
});

test('click-to-pin never activates the page: no click handler, no submit, no default action, no focus change', async t => {
  const context = page(t);
  const { window, $ } = context;
  const seen = [];
  $('save').addEventListener('click', () => seen.push('save click'));
  $('profile').addEventListener('submit', event => { event.preventDefault(); seen.push('submit'); });
  $('billing-link').addEventListener('click', event => { event.preventDefault(); seen.push('link click'); });
  context.document.addEventListener('click', () => seen.push('document click'));
  for (const type of ['pointerdown', 'mousedown']) $('save').addEventListener(type, () => seen.push(type));
  const { session, under } = sessionOn(t, context);
  session.start();
  pinAt(context, under, $('save'));
  session.setBubbleText('fictional');
  session.saveBubble();
  pinAt(context, under, $('billing-link'));
  session.cancelBubble();
  const submit = new window.Event('submit', { bubbles: true, cancelable: true });
  $('profile').dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true);
  assert.deepEqual(seen, [], 'the page saw nothing while commenting');
  assert.equal(session.getSnapshot().notes.length, 1);
  session.discard();
  mouse(window, 'click', $('save'));
  assert.ok(seen.includes('save click'), 'after feedback mode the page works again');
});

test('holding Alt lets clicks and keys reach the app and records them as steps (labels, route templates, named keys only); releasing returns to commenting', async t => {
  const context = page(t);
  const { window, $ } = context;
  const clicks = [];
  $('billing-link').addEventListener('click', event => { event.preventDefault(); clicks.push('billing'); window.history.pushState(null, '', '/settings/billing?token=hidden'); });
  $('plan').addEventListener('click', () => clicks.push('plan'));
  const { session, under, clock } = sessionOn(t, context);
  session.start();
  clock.t = 2000;
  pinAt(context, under, $('save'));
  session.setBubbleText('First note.');
  session.saveBubble();
  clock.t = 3000;
  keydown(window, context.document.body, 'Alt');
  assert.equal(session.getSnapshot().using, true);
  pinAt(context, under, $('billing-link'));
  assert.deepEqual(clicks, ['billing'], 'the click reached the app');
  await new Promise(resolve => setTimeout(resolve, 5));
  keydown(window, $('name'), 'S');
  keydown(window, $('name'), 'Enter');
  assert.equal(session.getSnapshot().notes.length, 1, 'no pin while using the app');
  keyup(window, context.document.body, 'Alt');
  assert.equal(session.getSnapshot().using, false);
  clock.t = 5000;
  pinAt(context, under, $('plan'));
  assert.deepEqual(clicks, ['billing'], 'back to commenting: the click is a pin');
  session.setBubbleText('Second note, on billing.');
  session.saveBubble();
  // The touch toggle does the same as Alt.
  session.setUseToggle(true);
  assert.equal(session.getSnapshot().using, true);
  press(window, $('plan'));
  assert.deepEqual(clicks, ['billing', 'plan']);
  session.setUseToggle(false);
  await session.done();
  const steps = session.draft().steps;
  assert.deepEqual(steps, [
    { kind: 'route', route: '/settings/:section' },
    { kind: 'note', note: 0 },
    { kind: 'click', target: 'link «Billing»' },
    { kind: 'key', key: 'Enter', target: 'textbox · masked' },
    { kind: 'note', note: 1 },
    { kind: 'click', target: 'button «Change plan»' },
  ]);
  const text = session.reportText();
  assert.ok(!text.includes('token=hidden') && !text.includes('"S"') && !text.includes('Fictional Studio Secret'), 'no query, no typed character, no form value');
  assert.equal(session.getSnapshot().stepCount, 4);
});

test('the review: edit and remove notes, a general note, highlight a note\'s element or say it is not on this page', async t => {
  const context = page(t);
  const { session, under } = sessionOn(t, context);
  session.start();
  for (const [id, text] of [['save', 'One.'], ['plan', 'Two.'], ['heading', 'Three.']]) { pinAt(context, under, context.$(id)); session.setBubbleText(text); session.saveBubble(); }
  await session.done();
  const ids = session.getSnapshot().notes.map(note => note.id);
  session.setNoteText(ids[1], 'Two, edited.');
  session.removeNote(ids[0]);
  session.setGeneral('Overall it is fine.');
  const state = session.getSnapshot();
  assert.deepEqual(state.notes.map(note => [note.number, note.text]), [[1, 'Two, edited.'], [2, 'Three.']]);
  assert.equal(session.highlight(ids[1]), 'shown');
  assert.deepEqual(allDrawn(context.document).map(item => item.tone), ['reveal']);
  context.$('heading').remove();
  assert.equal(session.highlight(ids[2]), 'not-on-page');
  assert.deepEqual(allDrawn(context.document), []);
  assert.equal(session.highlight(undefined), 'none');
  const draft = session.draft();
  assert.deepEqual(draft.notes.map(note => note.text), ['Two, edited.', 'Three.']);
  assert.deepEqual(draft.notes.map(note => note.anchor), [0, 1], 'anchors are renumbered to the notes that remain');
  assert.equal(draft.said, 'Overall it is fine.');
  session.removeNote(ids[1]);
  session.removeNote(ids[2]);
  assert.equal(session.getSnapshot().phase, 'review', 'the general note still says something');
  session.setGeneral('');
  assert.throws(() => session.draft(), /nothing to send/);
  session.removeNote(ids[2]);
  assert.equal(session.getSnapshot().phase, 'idle', 'removing the last of everything discards the draft');
});

test('Send: saved with one operation id per draft and attached as a mention; without a store the report is inline; a refusal sends nothing', async t => {
  const context = page(t);
  const requests = [];
  const answers = [{ kind: 'unknown', reason: 'The save did not answer.' }, { kind: 'saved', id: 'fb_7Q2mK9xRt4vW1cZp', revision: 'r1' }];
  const { session, under } = sessionOn(t, context, { save: async request => { requests.push(request); return answers.shift(); }, mention: id => `feedback/${id}.md` });
  session.start();
  pinAt(context, under, context.$('save'));
  session.setBubbleText('Fictional note.');
  session.saveBubble();
  await session.done();
  const first = await session.attach();
  assert.equal(first.kind, 'refused');
  assert.match(first.reason, /cannot be stored twice/);
  const second = await session.attach();
  assert.deepEqual(second, { kind: 'mention', id: 'fb_7Q2mK9xRt4vW1cZp', path: 'feedback/fb_7Q2mK9xRt4vW1cZp.md' });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].operationId, requests[1].operationId, 'one operation id across retries of the draft');
  assert.deepEqual(Object.keys(requests[0].draft).sort(), ['anchors', 'notes', 'observed', 'said', 'steps']);
  assert.deepEqual(await session.attach(), second, 'a saved draft is not saved again');
  session.sent();
  assert.equal(session.getSnapshot().phase, 'idle');

  const bare = sessionOn(t, page(t)).session;
  const other = page(t);
  const inline = sessionOn(t, other);
  inline.session.start();
  pinAt(other, inline.under, other.$('plan'));
  inline.session.setBubbleText('Inline note.');
  inline.session.saveBubble();
  await inline.session.done();
  const attached = await inline.session.attach();
  assert.equal(attached.kind, 'inline');
  const parsed = parseFeedback(new TextEncoder().encode(attached.text));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.report.notes[0].text, 'Inline note.');
  assert.equal((await bare.attach()).kind, 'refused', 'nothing to send outside review');
});

test('voice: the pointer trail and pins on one clock, aligned speech merged into notes (pin, hovered element, general)', async t => {
  const context = page(t);
  const { $ } = context;
  const calls = [];
  const voice = {
    start: async () => { calls.push('start'); return { kind: 'recording' }; },
    stop: async () => { calls.push('stop'); return { audio: new Blob(['fictional audio']), mimeType: 'audio/webm', startedAt: 10_000, endedAt: 30_000, truncated: false }; },
    cancel: () => calls.push('cancel'),
  };
  const transcribe = async (audio, mimeType) => {
    calls.push(`transcribe ${mimeType} ${audio.size}`);
    // Seconds from the start of the audio (10 000 ms on the session clock).
    return { segments: [
      { start: 1, end: 4, text: 'this heading is confusing' }, // hovered heading from 10.5 s to 15 s, never pinned
      { start: 7, end: 8, text: 'and the label is too long' }, // the Save pin at 17 s
      { start: 14, end: 16, text: 'overall it feels slow' }, // pointer over nothing
    ] };
  };
  const { session, under, clock } = sessionOn(t, context, { voice, transcribe });
  assert.equal(session.getSnapshot().voiceAvailable, true);
  session.start();
  clock.t = 10_000;
  await session.toggleVoice();
  assert.equal(session.getSnapshot().voice.kind, 'recording');
  clock.t = 10_500;
  under.current = [$('heading')];
  pointer(context.window, 'pointermove', context.document.body);
  clock.t = 15_000;
  under.current = [$('save')];
  pointer(context.window, 'pointermove', context.document.body);
  clock.t = 17_000;
  press(context.window, $('save'));
  // Recording mode: the click drops pin ① with no bubble; what is said around it becomes its note.
  assert.equal(session.getSnapshot().bubble, undefined, 'no bubble while recording');
  assert.deepEqual(session.getSnapshot().notes.map(note => [note.number, note.text, note.recorded]), [[1, '', true]], 'an empty pinned note, kept');
  assert.ok(allDrawn(context.document).some(item => item.label === pinMark(1) && item.tone === 'pinned'), 'the pin is drawn, numbered');
  // Clicking the same element again while recording opens nothing either.
  press(context.window, $('save'));
  assert.equal(session.getSnapshot().bubble, undefined);
  assert.equal(session.getSnapshot().notes.length, 1);
  clock.t = 22_000;
  under.current = [];
  pointer(context.window, 'pointermove', context.document.body);
  clock.t = 30_000;
  const trail = session.trail();
  assert.deepEqual(trail.pointer.map(sample => sample.t), [1000, 10_500, 15_000, 22_000], 'over nothing at start, then each change of element');
  assert.equal(trail.pointer.at(-1).target, null);
  assert.deepEqual(trail.pins.map(mark => mark.t), [17_000]);
  assert.equal(trail.pins[0].target, trail.pointer[2].target, 'pins and samples index the same session element list');
  await session.done();
  assert.deepEqual(calls, ['start', 'stop', 'transcribe audio/webm 15']);
  const state = session.getSnapshot();
  assert.equal(state.phase, 'review');
  assert.deepEqual(state.notes.map(note => [note.text, note.label, note.from ?? 'typed']), [
    ['this heading is confusing', 'heading «Notifications»', 'voice'],
    ['and the label is too long', 'button «Save profile»', 'voice'],
  ]);
  assert.equal(state.general, 'overall it feels slow');
  assert.equal(state.transcribing, false);
  const draft = session.draft();
  assert.deepEqual(draft.notes.map(note => [note.anchor, note.from]), [[0, 'voice'], [1, 'voice']]);
  assert.equal(draft.anchors[0].signals.role, 'heading');
  assert.equal(parseFeedback(new TextEncoder().encode(session.reportText())).ok, true);
});

test('voice: a refused microphone or a failed transcription keeps the typed notes and says so', async t => {
  const context = page(t);
  const refused = sessionOn(t, context, { voice: { start: async () => ({ kind: 'refused', reason: 'voice not available' }), stop: async () => null, cancel: () => {} }, transcribe: async () => ({ segments: [] }) });
  refused.session.start();
  await refused.session.toggleVoice();
  assert.deepEqual(refused.session.getSnapshot().voice, { kind: 'refused', reason: 'voice not available' });
  // The refusal's code is kept for the bar; a click after a refusal is an ordinary pin with its bubble.
  refused.session.discard();
  const coded = sessionOn(t, context, { voice: { start: async () => ({ kind: 'refused', code: 'denied', reason: 'Microphone blocked.' }), stop: async () => null, cancel: () => {} }, transcribe: async () => ({ segments: [] }) });
  coded.session.start();
  await coded.session.toggleVoice();
  assert.deepEqual(coded.session.getSnapshot().voice, { kind: 'refused', code: 'denied', reason: 'Microphone blocked.' });
  pinAt(context, coded.under, context.$('save'));
  assert.equal(coded.session.getSnapshot().bubble?.number, 1);
  coded.session.discard();
  refused.session.discard();
  const failing = sessionOn(t, context, {
    voice: { start: async () => ({ kind: 'recording' }), stop: async () => ({ audio: new Blob(['x']), mimeType: 'audio/webm', startedAt: 0, endedAt: 1, truncated: false }), cancel: () => {} },
    transcribe: async () => { throw new Error('the transcription answered 502'); },
  });
  failing.session.start();
  pinAt(context, failing.under, context.$('plan'));
  failing.session.setBubbleText('Typed note.');
  failing.session.saveBubble();
  await failing.session.toggleVoice();
  pinAt(context, failing.under, context.$('save'));
  assert.equal(failing.session.getSnapshot().bubble, undefined, 'recording: a click pins without a bubble');
  let transcribing;
  const off = failing.session.subscribe(() => { if (failing.session.getSnapshot().transcribing) transcribing = failing.session.getSnapshot().phase; });
  await failing.session.done();
  off();
  assert.equal(transcribing, 'processing', 'Done says it is transcribing while it does');
  const failed = failing.session.getSnapshot();
  assert.equal(failed.phase, 'review');
  assert.equal(failed.problem, 'Voice could not be transcribed (the transcription answered 502). Your pins are kept: type a note for each in the review.');
  assert.deepEqual(failed.notes.map(note => [note.text, note.recorded ?? false]), [['Typed note.', false], ['', true]], 'the pin is kept as an empty note');
  assert.deepEqual(failing.session.draft().notes.map(note => note.text), ['Typed note.'], 'an empty pin is not sent');
  failing.session.setNoteText(failed.notes[1].id, 'Typed after all.');
  assert.deepEqual(failing.session.draft().notes.map(note => note.text), ['Typed note.', 'Typed after all.']);
  failing.session.discard();
  // Stop, then Done before the capture handed the audio over: Done waits for it (the recording was once silently lost here).
  let handOver;
  const slow = sessionOn(t, context, {
    voice: { start: async () => ({ kind: 'recording' }), stop: () => new Promise(resolve => { handOver = () => resolve({ audio: new Blob(['x']), mimeType: 'audio/webm', startedAt: 0, endedAt: 3000, truncated: false }); }), cancel: () => {} },
    transcribe: async () => ({ segments: [{ start: 0.5, end: 1.5, text: 'said while pinning' }] }),
  });
  slow.session.start();
  slow.clock.t = 0;
  await slow.session.toggleVoice();
  slow.clock.t = 1000;
  pinAt(context, slow.under, context.$('save'));
  const stopped = slow.session.toggleVoice();
  assert.equal(slow.session.getSnapshot().voice.kind, 'stopping');
  const finished = slow.session.done();
  await new Promise(resolve => setTimeout(resolve, 5));
  handOver();
  await stopped; await finished;
  assert.deepEqual(slow.session.getSnapshot().notes.map(note => note.text), ['said while pinning']);
  assert.equal(slow.session.getSnapshot().voice.kind, 'off');
  slow.session.discard();
  // A recording that captured nothing says so instead of silently keeping nothing.
  const silent = sessionOn(t, context, { voice: { start: async () => ({ kind: 'recording' }), stop: async () => null, cancel: () => {} }, transcribe: async () => ({ segments: [] }) });
  silent.session.start();
  await silent.session.toggleVoice();
  await silent.session.toggleVoice();
  assert.equal(silent.session.getSnapshot().problem, 'Nothing was recorded: the microphone gave no sound. Your pins are kept.');
  silent.session.discard();
  assert.equal(sessionOn(t, context).session.getSnapshot().voiceAvailable, false, 'no voice without both a capture and a transcription');
});

test('voice: transcription is the host\'s callback; text only, timed segments, a throw or garbage are each handled without a schema', async t => {
  const context = page(t);
  const recording = { audio: new Blob(['fictional audio']), mimeType: 'audio/webm', startedAt: 10_000, endedAt: 20_000, truncated: false };
  const capture = () => ({ start: async () => ({ kind: 'recording' }), stop: async () => recording, cancel: () => {} });
  /** Record from 10 s, pin Save at 12 s (one pin made while recording), pointer over nothing from 14 s, stop at 20 s, Done. */
  const run = async transcribe => {
    const opened = sessionOn(t, context, { voice: capture(), transcribe });
    const { session, under, clock } = opened;
    session.start();
    clock.t = 10_000;
    await session.toggleVoice();
    clock.t = 12_000;
    pinAt(context, under, context.$('save'));
    clock.t = 14_000;
    under.current = [];
    pointer(context.window, 'pointermove', context.document.body);
    clock.t = 20_000;
    await session.done();
    const state = session.getSnapshot();
    session.discard();
    return state;
  };
  // No callback: voice is not offered, and toggling does nothing (no error).
  const bare = sessionOn(t, context, { voice: capture() });
  assert.equal(bare.session.getSnapshot().voiceAvailable, false, 'no Record without a transcribe callback');
  bare.session.start();
  await bare.session.toggleVoice();
  assert.deepEqual(bare.session.getSnapshot().voice, { kind: 'off' });
  assert.equal(bare.session.getSnapshot().problem, undefined);
  bare.session.discard();
  // Text only (no timed segments): one general note; the pin made while recording stays an empty note to type into.
  const textOnly = await run(async () => ({ text: '  The save button says nothing.  ', model: 'any-extra-field-is-ignored' }));
  assert.equal(textOnly.general, 'The save button says nothing.');
  assert.deepEqual(textOnly.notes.map(note => [note.text, note.recorded ?? false]), [['', true]]);
  assert.equal(textOnly.problem, undefined);
  assert.equal(textOnly.phase, 'review');
  // An empty segments list with text is the same as text only.
  assert.equal((await run(async () => ({ text: 'Only text.', segments: [] }))).general, 'Only text.');
  // Timed segments: aligned with the pins and the pointer (the pin wins for what is said around it; the rest is general).
  const timed = await run(async () => ({ text: 'ignored when segments are usable', segments: [
    { start: 1.5, end: 2.5, text: 'Save says nothing.', confidence: 0.9 },
    { start: 6, end: 7, text: 'Overall fine.' },
    { start: 'x', end: 9, text: 'malformed segment dropped' },
  ] }));
  assert.deepEqual(timed.notes.map(note => [note.text, note.label, note.from ?? 'typed']), [['Save says nothing.', 'button «Save profile»', 'voice']]);
  assert.equal(timed.general, 'Overall fine.');
  // A throwing callback: a plain message with the callback's reason; pins kept.
  const thrown = await run(async () => { throw new Error('the service is down'); });
  assert.equal(thrown.problem, 'Voice could not be transcribed (the service is down). Your pins are kept: type a note for each in the review.');
  assert.deepEqual(thrown.notes.map(note => [note.text, note.recorded ?? false]), [['', true]]);
  // Garbage: neither usable segments nor text. The plain message, pins kept, nothing thrown out of Done.
  for (const garbage of [null, 'just a string', 42, {}, { segments: 'nope' }, { text: 7 }, { segments: [{ text: 'no times' }] }]) {
    const state = await run(async () => garbage);
    assert.equal(state.problem, 'Voice could not be transcribed. Your pins are kept: type a note for each in the review.', JSON.stringify(garbage));
    assert.deepEqual(state.notes.map(note => [note.text, note.recorded ?? false]), [['', true]]);
    assert.equal(state.general, '');
  }
  // A non-Error throw is the plain message too.
  assert.equal((await run(async () => { throw 'boom'; })).problem, 'Voice could not be transcribed. Your pins are kept: type a note for each in the review.');
});

// --- the registry components ---------------------------------------------------------------------------------------------------------

async function registry(t, url = 'https://fictional.invalid/settings/profile') {
  const out = join(root, '.cache/feedback-session-test');
  mkdirSync(out, { recursive: true });
  await build({ entryPoints: [join(root, 'registry/feedback/feedback-session.tsx')], outfile: join(out, 'feedback-session.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const window = new Window({ url, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  t.after(async () => {
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const components = await import(pathToFileURL(join(out, 'feedback-session.mjs')).href);
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  return { window, document: window.document, components, createElement, act, createRoot };
}
const setValue = (window, element, value) => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new window.Event('input', { bubbles: true })); };

test('registry: the bar, the bubble (Enter saves, Esc discards), the chip and its review (edit, remove, hover highlights), useComposerFeedback attaches', { timeout: 30000 }, async t => {
  const { window, document, components, createElement, act, createRoot } = await registry(t);
  const { FeedbackBar, NoteBubble, FeedbackChip, useComposerFeedback } = components;
  document.body.innerHTML = PAGE;
  const context = { window, document, root: document.getElementById('app'), $: id => document.getElementById(id) };
  const { session, under } = sessionOn(t, context, { save: async () => ({ kind: 'saved', id: 'fb_7Q2mK9xRt4vW1cZp', revision: 'r1' }), mention: id => `feedback/${id}.md` });
  let composer;
  function Host() { composer = useComposerFeedback(session); return createElement('div', null, createElement(FeedbackBar, { session }), createElement(NoteBubble, { session }), composer?.chip ?? null); }
  const ui = createRoot(document.getElementById('ui'));
  await act(async () => ui.render(createElement(Host)));
  assert.equal(document.querySelector('[data-testid=feedback-bar]'), null, 'no bar before Feedback is pressed');
  assert.equal(composer.active, false);
  await act(async () => composer.start());
  const bar = document.querySelector('[data-testid=feedback-bar]');
  assert.ok(bar.hasAttribute('data-feedback-ignore'));
  assert.match(bar.textContent, /Feedback0 notes.*Hold ⌥ to use the app.*Use app.*Done/);
  assert.equal(document.querySelector('[data-testid=feedback-voice]'), null, 'no voice toggle without voice');
  assert.equal(composer.active, true);
  assert.ok(composer.bar, 'feedback mode docks its bar under the composer');
  assert.equal(document.querySelector('[data-testid=feedback-bar-hint]').textContent, 'Click what you want to comment on');

  await act(async () => pinAt(context, under, context.$('save')));
  let input = document.querySelector('[data-testid=feedback-bubble-input]');
  assert.equal(input.getAttribute('placeholder'), "What's wrong here?");
  assert.equal(document.querySelector('[data-testid=feedback-bubble-label]').textContent, 'button «Save profile»');
  await act(async () => setValue(window, input, 'Say what it saves.'));
  await act(async () => { keydown(window, input, 'Enter'); });
  assert.equal(document.querySelector('[data-testid=feedback-bubble]'), null, 'Enter saved the note');
  assert.equal(document.querySelector('[data-testid=feedback-bar-count]').textContent, '1 note');
  await act(async () => pinAt(context, under, context.$('plan')));
  input = document.querySelector('[data-testid=feedback-bubble-input]');
  await act(async () => setValue(window, input, 'never mind'));
  await act(async () => { keydown(window, input, 'Escape'); });
  assert.equal(document.querySelector('[data-testid=feedback-bubble]'), null, 'Esc discarded the pin');
  assert.equal(session.getSnapshot().notes.length, 1);
  assert.equal(session.getSnapshot().phase, 'active', 'Esc in the bubble does not end feedback mode');
  await act(async () => pinAt(context, under, context.$('heading')));
  await act(async () => setValue(window, document.querySelector('[data-testid=feedback-bubble-input]'), 'A second note.'));
  await act(async () => { keydown(window, document.querySelector('[data-testid=feedback-bubble-input]'), 'Enter'); });
  await act(async () => document.querySelector('[data-testid=feedback-use-app]').click());
  assert.equal(document.querySelector('[data-testid=feedback-bar]').dataset.using, 'true');
  await act(async () => document.querySelector('[data-testid=feedback-use-app]').click());
  await act(async () => { document.querySelector('[data-testid=feedback-done]').click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.equal(document.querySelector('[data-testid=feedback-bar]'), null);
  assert.equal(composer.pending, true);
  const chip = document.querySelector('[data-testid=feedback-chip]');
  assert.equal(chip.querySelector('[data-testid=feedback-chip-open]').textContent, '💬 Feedback · 2 notes · /settings/:section');

  await act(async () => chip.querySelector('[data-testid=feedback-chip-open]').click());
  const notes = () => [...document.querySelectorAll('[data-testid=feedback-review-note]')];
  assert.equal(notes().length, 2);
  await act(async () => { notes()[0].dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); });
  assert.deepEqual(allDrawn(document).map(item => item.tone), ['reveal'], 'hovering a note highlights its element');
  await act(async () => setValue(window, notes()[1].querySelector('[data-testid=feedback-review-text]'), 'A second note, edited.'));
  await act(async () => notes()[0].querySelector('[data-testid=feedback-review-remove]').click());
  assert.deepEqual(notes().map(item => item.querySelector('textarea').value), ['A second note, edited.']);
  assert.equal(document.querySelector('[data-testid=feedback-chip-open]').textContent, '💬 Feedback · 1 note · /settings/:section');

  const attached = await composer.attach('Please look at this.');
  assert.deepEqual(attached, { kind: 'ok', text: 'Please look at this.\n\n@feedback/fb_7Q2mK9xRt4vW1cZp.md' });
  assert.deepEqual(await composer.attach(''), { kind: 'ok', text: '@feedback/fb_7Q2mK9xRt4vW1cZp.md' });
  await act(async () => composer.sent());
  assert.equal(document.querySelector('[data-testid=feedback-chip]'), null);
  assert.equal(composer.pending, false);
  // × on the chip discards.
  await act(async () => composer.start());
  await act(async () => pinAt(context, under, context.$('save')));
  await act(async () => setValue(window, document.querySelector('[data-testid=feedback-bubble-input]'), 'x'));
  await act(async () => { keydown(window, document.querySelector('[data-testid=feedback-bubble-input]'), 'Enter'); });
  await act(async () => { document.querySelector('[data-testid=feedback-done]').click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  await act(async () => document.querySelector('[data-testid=feedback-chip-discard]').click());
  assert.equal(session.getSnapshot().phase, 'idle');
  await act(async () => ui.unmount());
});

test('registry: recording mode in the bar (Record, red dot, timer, Stop), clicks pin without a bubble, Transcribing…, every failure said in the bar', { timeout: 30000 }, async t => {
  const { window, document, components, createElement, act, createRoot } = await registry(t);
  const { FeedbackBar, NoteBubble, FeedbackChip } = components;
  const { VOICE_REFUSALS } = await import('@hachej/boring-feedback/page');
  document.body.innerHTML = PAGE.replace('<button type="submit" id="save"', '<button type="submit" id="save" data-source="src/settings/SettingsPage.jsx:65"');
  const context = { window, document, root: document.getElementById('app'), $: id => document.getElementById(id) };
  let finishTranscription;
  let failTranscription = false;
  const voice = { start: async () => ({ kind: 'recording' }), stop: async () => ({ audio: new Blob(['fictional audio']), mimeType: 'audio/webm', startedAt: 0, endedAt: 5000, truncated: false }), cancel: () => {} };
  const transcribe = () => new Promise((resolve, reject) => { finishTranscription = () => failTranscription ? reject(new Error('the transcription answered 502')) : resolve({ segments: [{ start: 0.5, end: 1.5, text: 'Save says nothing.' }, { start: 2.5, end: 3.5, text: 'Rename this heading.' }] }); });
  const { session, under, clock } = sessionOn(t, context, { voice, transcribe });
  const ui = createRoot(document.getElementById('ui'));
  await act(async () => ui.render(createElement('div', null, createElement(FeedbackBar, { session, docked: true }), createElement(NoteBubble, { session }), createElement(FeedbackChip, { session, defaultOpen: true }))));
  const $t = id => document.querySelector(`[data-testid=${id}]`);
  await act(async () => session.start());
  assert.equal($t('feedback-voice').textContent, 'Record', 'a labelled Record button');
  assert.equal($t('feedback-recording'), null);
  clock.t = 0;
  await act(async () => $t('feedback-voice').click());
  assert.equal($t('feedback-bar').dataset.recording, 'true');
  assert.equal($t('feedback-voice').textContent, 'Stop');
  assert.equal($t('feedback-voice').getAttribute('aria-pressed'), 'true');
  assert.equal($t('feedback-recording-time').textContent, '00:00', 'a running timer, mm:ss');
  assert.ok($t('feedback-recording').querySelector('.boring-feedback-rec'), 'a red dot');
  assert.equal($t('feedback-bar-hint').textContent, 'Recording — point and talk');
  assert.equal(components.elapsed(65_000), '01:05');
  // Two clicks while recording: two numbered pins, no bubble, nothing to type.
  clock.t = 1000;
  await act(async () => pinAt(context, under, context.$('save')));
  assert.equal($t('feedback-bubble'), null, 'no note bubble while recording');
  clock.t = 3000;
  await act(async () => pinAt(context, under, context.$('heading')));
  assert.equal($t('feedback-bubble'), null);
  assert.equal($t('feedback-bar-count').textContent, '0 notes · 2 pins');
  assert.equal(allDrawn(document).filter(item => item.tone === 'pinned').length, 2);
  // Stop, then Done: "Transcribing…" until the notes are merged, then the chip counts them.
  await act(async () => $t('feedback-voice').click());
  assert.equal($t('feedback-voice').textContent, 'Record');
  let done;
  await act(async () => { done = session.done(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.equal($t('feedback-bar-hint').textContent, 'Transcribing…');
  assert.equal($t('feedback-bar').dataset.transcribing, 'true');
  await act(async () => { finishTranscription(); await done; });
  assert.equal($t('feedback-bar'), null);
  assert.equal($t('feedback-chip-open').textContent, '💬 Feedback · 2 notes · /settings/:section');
  assert.deepEqual([...document.querySelectorAll('[data-testid=feedback-review-text]')].map(area => area.value), ['Save says nothing.', 'Rename this heading.']);
  // The review reads like the card: the readable name, the file basename, the full path only in the tooltip; "voice" as a badge.
  const element = document.querySelector('[data-testid=feedback-review-element]');
  assert.equal(element.querySelector('[data-testid=feedback-review-name]').textContent, '«Save profile» button');
  assert.equal(element.querySelector('[data-testid=feedback-review-file]').textContent, 'SettingsPage.jsx:65');
  assert.equal(element.getAttribute('title'), 'src/settings/SettingsPage.jsx:65');
  assert.equal(document.querySelectorAll('[data-testid=feedback-review-voice]').length, 2);
  await act(async () => session.discard());

  // A failed transcription: said in the chip and the review; the pins stay as empty notes to type into.
  failTranscription = true;
  await act(async () => session.start());
  clock.t = 0;
  await act(async () => $t('feedback-voice').click());
  clock.t = 1000;
  await act(async () => pinAt(context, under, context.$('save')));
  await act(async () => { done = session.done(); await new Promise(resolve => setTimeout(resolve, 10)); });
  await act(async () => { finishTranscription(); await done; });
  assert.equal($t('feedback-chip-open').textContent, '💬 Feedback · 0 notes · 1 pin to describe · /settings/:section');
  assert.equal($t('feedback-chip-voice').textContent, 'Voice could not be transcribed (the transcription answered 502). Your pins are kept: type a note for each in the review.');
  assert.equal($t('feedback-review-problem').textContent, $t('feedback-chip-voice').textContent);
  assert.equal($t('feedback-review-text').value, '');
  assert.match($t('feedback-review-text').getAttribute('placeholder'), /type a note/);
  await act(async () => session.discard());

  // Each microphone refusal is said in the bar itself (role=alert), not only in a tooltip.
  for (const [code, reason] of Object.entries(VOICE_REFUSALS)) {
    voice.start = async () => ({ kind: 'refused', code, reason });
    await act(async () => session.start());
    await act(async () => $t('feedback-voice').click());
    const problem = $t('feedback-voice-problem');
    assert.equal(problem.getAttribute('role'), 'alert');
    assert.equal(problem.dataset.code, code);
    assert.equal(problem.textContent, reason);
    assert.equal($t('feedback-recording'), null);
    assert.equal($t('feedback-voice').disabled, false, 'Record can be pressed again');
    await act(async () => pinAt(context, under, context.$('save')));
    assert.ok($t('feedback-bubble'), 'not recording: a click opens the bubble as usual');
    await act(async () => session.discard());
  }
  assert.deepEqual(Object.keys(VOICE_REFUSALS).sort(), ['busy', 'denied', 'failed', 'insecure', 'no-microphone', 'unsupported']);
  await act(async () => ui.unmount());
});

test('registry: without a store, Send inlines the rendered report in a fence longer than any backtick run; the review can Copy', { timeout: 30000 }, async t => {
  const { window, document, components, createElement, act, createRoot } = await registry(t);
  const { FeedbackChip, useComposerFeedback } = components;
  document.body.innerHTML = PAGE;
  const context = { window, document, root: document.getElementById('app'), $: id => document.getElementById(id) };
  const copied = [];
  const { session, under } = sessionOn(t, context, { copyText: async text => { copied.push(text); return true; } });
  let composer;
  function Host() { composer = useComposerFeedback(session); return createElement(FeedbackChip, { session, defaultOpen: true, copy: true }); }
  const ui = createRoot(document.getElementById('ui'));
  await act(async () => ui.render(createElement(Host)));
  context.$('profile').insertAdjacentHTML('beforeend', '<button type="button" id="ticks">Run ```` code</button>');
  session.start();
  pinAt(context, under, context.$('ticks'));
  session.setBubbleText('Use ``` fences carefully.');
  session.saveBubble();
  await act(async () => session.done());
  const attached = await composer.attach('Here:');
  assert.equal(attached.kind, 'ok');
  const fence = /\n\n(`{5,})markdown\n/.exec(attached.text)?.[1];
  assert.equal(fence, '`````', 'the fence is longer than the longest backtick run');
  const body = attached.text.slice(attached.text.indexOf('markdown\n') + 9, attached.text.lastIndexOf(fence));
  assert.equal(parseFeedback(new TextEncoder().encode(body)).ok, true);
  await act(async () => document.querySelector('[data-testid=feedback-copy]').click());
  assert.equal(document.querySelector('[data-testid=feedback-status]').dataset.copy, 'copied');
  assert.equal(parseFeedback(new TextEncoder().encode(copied[0])).ok, true, 'Copy works with no store and no chat');
  await act(async () => ui.unmount());
});

test('the privacy canary kit over the bar, the bubble, the chip, the review, the steps, the trail and the report', { timeout: 60000 }, async t => {
  const { window, document, components, createElement, act, createRoot } = await registry(t);
  const { FeedbackBar, NoteBubble, FeedbackChip } = components;
  document.body.innerHTML = '<div id="app"><header data-feedback-visible=""><h1>Fictional settings</h1></header><main></main></div><div id="ui" data-feedback-ignore=""></div>';
  const app = document.getElementById('app');
  const result = await runPrivacyCanaries({
    page: { document, root: app.querySelector('main') },
    run: async ({ root: section, location }, emit) => {
      const elements = [section, ...section.querySelectorAll('*')].filter(element => element.localName !== 'script');
      const under = { current: [] };
      const clock = { t: 0 };
      const voice = { start: async () => ({ kind: 'recording' }), stop: async () => ({ audio: new Blob(['x']), mimeType: 'audio/webm', startedAt: 0, endedAt: 1e6, truncated: false }), cancel: () => {} };
      const session = createFeedbackSession({ app: 'fictional-settings', root: app, policy: createPrivacyPolicy(), location: () => location, hitTest: () => under.current, now: () => clock.t,
        voice, transcribe: async () => ({ segments: [{ start: 1, end: 2, text: 'fictional speech' }] }), copyText: async () => true });
      const ui = createRoot(document.getElementById('ui'));
      await act(async () => ui.render(createElement('div', null, createElement(FeedbackBar, { session }), createElement(NoteBubble, { session }), createElement(FeedbackChip, { session, defaultOpen: true, copy: true }))));
      await act(async () => session.start());
      await act(async () => session.toggleVoice());
      for (const [index, element] of elements.entries()) {
        clock.t += 100;
        under.current = [element];
        await act(async () => { pointer(window, 'pointermove', document.body); });
        emit('bar', document.querySelector('[data-testid=feedback-bar]')?.textContent ?? '');
        if (index % 3 === 0) {
          await act(async () => { press(window, element); });
          emit('bubble', document.querySelector('[data-testid=feedback-bubble]')?.textContent ?? '');
          if (session.getSnapshot().bubble) await act(async () => { session.setBubbleText(`note ${index}`); session.saveBubble(); });
        } else if (index % 3 === 1) {
          await act(async () => { keydown(window, document.body, 'Alt'); press(window, element); keydown(window, element, 'Enter'); keyup(window, document.body, 'Alt'); });
        }
      }
      emit('overlay', [...document.querySelectorAll('[data-feedback-overlay]')].map(host => host.shadowRoot.textContent));
      emit('trail', session.trail());
      await act(async () => session.done());
      const state = session.getSnapshot();
      emit('state', { notes: state.notes, general: state.general, route: state.route, problem: state.problem });
      emit('chip', document.querySelector('[data-testid=feedback-chip]')?.textContent ?? '');
      emit('review', document.querySelector('[data-testid=feedback-review]')?.textContent ?? '');
      if (state.phase === 'review') {
        emit('draft', session.draft());
        emit('report', session.reportText());
        await act(async () => session.copy());
        emit('copy', session.getSnapshot().copy);
      }
      await act(async () => ui.unmount());
      session.dispose();
    },
  });
  assert.deepEqual(result.hits, [], `canaries leaked: ${JSON.stringify(result.hits)}`);
  assert.ok(result.scanned > 50, `the kit scanned the outputs (${result.scanned})`);
});

test('registry: with a voice capture but no transcribe callback the bar offers no Record button', { timeout: 30000 }, async t => {
  const { window, document, components, createElement, act, createRoot } = await registry(t);
  const { FeedbackBar } = components;
  document.body.innerHTML = PAGE;
  const context = { window, document, root: document.getElementById('app'), $: id => document.getElementById(id) };
  const { session } = sessionOn(t, context, { voice: { start: async () => ({ kind: 'recording' }), stop: async () => null, cancel: () => {} } });
  const ui = createRoot(document.getElementById('ui'));
  await act(async () => ui.render(createElement(FeedbackBar, { session })));
  await act(async () => session.start());
  assert.ok(document.querySelector('[data-testid=feedback-bar]'));
  assert.equal(document.querySelector('[data-testid=feedback-voice]'), null);
  await act(async () => ui.unmount());
});
