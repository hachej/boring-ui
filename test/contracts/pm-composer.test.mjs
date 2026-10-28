import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

mkdirSync('.cache/pm-composer-test', { recursive: true });
await build({ stdin: { contents: `export { PmComposer } from './registry/pm-panel/pm-composer'; export { pointMessage, POINT_PREFACE } from './registry/pm-panel/point-message';`, resolveDir: process.cwd(), loader: 'tsx' }, outfile: '.cache/pm-composer-test/composer.mjs', bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', alias: { '@': `${process.cwd()}/examples/app-shell` } });
const { PmComposer, pointMessage, POINT_PREFACE } = await import(pathToFileURL(`${process.cwd()}/.cache/pm-composer-test/composer.mjs`));
const noop = () => {};
const baseVoice = { canStart: true, phase: 'idle', seconds: 0, captureSequence: 0, pending: [], problem: undefined, start: noop, finish: noop, cancel: noop };
const base = { text: '', onText: noop, attachments: [], onRemoveAttachment: noop, working: false, sendBlocked: false, disabled: false, stopRequested: false, onSend: noop, onStop: noop, uploading: false, canAttach: true, fileAccept: 'image/*', onPickFiles: noop, textareaRef: null };

test('one host-agnostic PmComposer renders sheet, desktop column and ambient hosts', () => {
  for (const host of ['sheet', 'conversation-column', 'studio-ambient']) {
    const html = renderToStaticMarkup(h('section', { 'data-host': host }, h(PmComposer, { composer: base, show: false, onShow: noop, voice: baseVoice })));
    for (const id of ['composer-plus', 'pm-show', 'pm-mic', 'composer-submit']) assert.match(html, new RegExp(`data-testid="${id}"`), host);
    assert.match(html, /Décrivez le problème, ou/);
    assert.match(html, /aria-label="Montrer"/);
    assert.doesNotMatch(html, /Coach|Max|fixed|absolute.*data-host/);
  }
});

test('C3 initially has only hint, mic and done; no timer, counter or automatic recording', () => {
  const html = renderToStaticMarkup(h(PmComposer, { variant: 'strip', show: true, onShow: noop, onReturn: noop, voice: baseVoice }));
  assert.match(html, /Touchez ce que vous voulez montrer/);
  assert.match(html, /aria-label="Terminé"/);
  assert.match(html, /data-pm-strip/);
  assert.doesNotMatch(html, /pm-timer|radiogroup|pm-pause|sélectionnés/);
});

test('C4/C5 share one exclusive selection toggle and the recorder button; mic and pause never show together', () => {
  for (const paused of [false, true]) for (const show of [true, false]) {
    const html = renderToStaticMarkup(h(PmComposer, { variant: 'strip', show, onShow: noop, onReturn: noop, onOpenRecorder: noop,
      voice: { ...baseVoice, phase: 'recording', seconds: 14, paused, pause: noop, resume: noop } }));
    assert.match(html, /role="radiogroup"/);
    assert.match(html, /aria-label="Sélectionner"/);
    assert.match(html, /aria-label="Naviguer"/);
    assert.match(html, /aria-label="Ouvrir l’enregistreur"/, 'R7: the timer is a button that opens the recorder');
    assert.match(html, /0:14/);
    // Spec 1 §1: paused swaps pause for the mic (resume); the two never show together.
    assert.equal((html.match(/data-testid="pm-pause"/g) ?? []).length, paused ? 0 : 1);
    assert.equal((html.match(/data-testid="pm-mic"/g) ?? []).length, paused ? 1 : 0);
    assert.equal(/data-testid="pm-hint"/.test(html), show, 'navigate mode hides the hint (C5)');
    assert.match(html, paused ? /data-phase="paused"/ : /data-phase="rec"/);
    // Left to right: toggle · hint · timer · pause (or mic) · ×.
    const order = ['radiogroup', show ? 'pm-hint' : 'pm-timer', 'pm-timer', paused ? '"pm-mic"' : '"pm-pause"', '"pm-done"'].map(token => html.indexOf(token));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  }
});

test('C7 renders timestamped selections inline in the transcript, not a separate chip row', () => {
  const text = `Sur cette carte ① je veux changer la couleur, comme cette jauge ②.\n${POINT_PREFACE}${JSON.stringify({ format: 'pm.points@1', dictatedSeconds: 14,
    selections: [{ n: 1, kind: 'Carte', label: 'Déjeuner', screen: 'jour', atMs: 2000 }, { n: 2, kind: 'Jauge', label: 'Protéines', screen: 'progres', atMs: 9000 }] })}`;
  const entry = { model: [{ role: 'user', content: text }] };
  const card = pointMessage(entry);
  assert.equal(card.inline, true);
  const html = renderToStaticMarkup(card.content);
  assert.match(html, /Sur cette carte/);
  const plain = html.replace(/<span class="sr-only">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(plain, /1 Carte · Déjeuner 0:02/);
  assert.match(plain, /2 Jauge · Protéines 0:09/);
  assert.ok(plain.indexOf('1 Carte') < plain.indexOf('je veux changer'));
  assert.doesNotMatch(html, /Retirer/, 'a sent chip has no ×');
  assert.match(html, /Dicté · 0:14 · 2 captures/);
  assert.doesNotMatch(html, /role="list"|pm.points@1/);
  assert.equal(pointMessage({ model: [{ role: 'assistant', content: [{ type: 'text', text }] }] }), undefined);
  assert.equal(pointMessage({ model: [{ role: 'user', content: `${POINT_PREFACE}{"format":"pm.points@1","selections":[null]}` }] }), undefined);
});
