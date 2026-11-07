// D-1764: InlineQuestion options are equal (outline) unless the data marks one `recommended`; then only the first marked one is primary.
// A decision keeps Approve primary / Refuse secondary. The real component rendered in happy-dom. Fictional text only. Booleans are compared, never elements.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

test('only an option marked recommended is the primary button', { timeout: 60000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'KeyboardEvent', 'Event', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const given = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof given === 'function' && /^[a-z]/.test(name) ? given.bind(window) : given });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/inline-question-options/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('card.mjs', out);
  await build({ stdin: { contents: `export { InlineQuestion } from './inline-question/inline-question.tsx';`, resolveDir: new URL('../../registry/', import.meta.url).pathname, loader: 'tsx' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' } });
  const { InlineQuestion } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const draw = async props => { await act(async () => root.render(createElement(InlineQuestion, { id: 'q', text: 'Quelle archive fictive faut-il nettoyer en premier ?', onAnswer: () => {}, ...props }))); };
  const primary = () => [...element.querySelectorAll('[data-testid=question-option]')].map(b => String(b.getAttribute('class')).split(/\s+/).includes('bg-primary'));
  const a = 'Archiver les anciens dossiers fictifs dès cette semaine, avant la clôture du trimestre';
  const b = 'Attendre la prochaine revue mensuelle fictive pour décider avec toute l’équipe réunie';
  const c = 'Ne rien archiver pour l’instant et demander un avis complémentaire au service voisin';

  await draw({ kind: 'question', options: [a, b, c] });
  assert.equal(JSON.stringify(primary()), JSON.stringify([false, false, false]), 'no marker: none is primary');

  await draw({ kind: 'question', options: [a, { label: b, recommended: true }, c] });
  assert.equal(JSON.stringify(primary()), JSON.stringify([false, true, false]), 'the marked one only, whatever its position');

  await draw({ kind: 'question', options: [a, { label: b, recommended: true }, { label: c, recommended: true }] });
  assert.equal(JSON.stringify(primary()), JSON.stringify([false, true, false]), 'several marked: the first marked one only');

  await draw({ kind: 'decision' });
  assert.equal(JSON.stringify(primary()), JSON.stringify([true, false]), 'a decision keeps Approve primary and Refuse not');
});
