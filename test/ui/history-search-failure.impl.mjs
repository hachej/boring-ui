// A search that fails says so, and "No conversation matches" stays for a real no-match (D-1562): the real ConversationList over the real
// useConversationsClient, with a fetch that answers as a server would. Fictional text only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const SAID = 'Search failed. Try again.';
const listed = [{ id: 1, title: 'Fictional harbour', lastMessage: null, updatedAt: 1, archived: false }, { id: 2, title: 'Fictional lighthouse', lastMessage: null, updatedAt: 1, archived: false }];
const refused = () => Response.json({ error: 'platform-pm-refused', message: 'query: q is not accepted' }, { status: 400 });
const held = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('History search', { timeout: 90000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'addEventListener', 'removeEventListener', 'matchMedia', 'sessionStorage', 'localStorage', 'location', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const { useConversationsClient } = await import('@hachej/boring-ui-kit/chat-react');
  const out = new URL('../../.cache/history-search-failure/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('history.mjs', out);
  await build({ stdin: { contents: `export { ConversationList } from './pi-chat/history.tsx'; export { ChatTextProvider, defaultChatText } from './pi-chat/labels.ts'; export { frenchChatLabels } from './pi-chat/labels-fr.ts';`, resolveDir: new URL('../../registry/', import.meta.url).pathname, loader: 'ts' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { ConversationList, ChatTextProvider, defaultChatText, frenchChatLabels } = await import(output.href);

  const element = document.createElement('div'); document.body.append(element);
  let root;
  const close = async () => { if (root) await act(async () => root.unmount()); root = undefined; };
  t.after(async () => {
    await close(); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });

  const q = selector => element.querySelector(selector);
  const rows = () => [...element.querySelectorAll('[data-testid=conversation-row]')].map(row => row.textContent.includes('harbour') ? 'harbour' : 'lighthouse');
  const said = () => q('[role=alert]')?.textContent ?? null;
  const empty = () => q('[data-testid=conversations-empty]')?.textContent ?? null;
  const until = async (check, what) => {
    for (let turn = 0; turn < 150; turn += 1) {
      if (check()) return;
      await act(async () => { await new Promise(done => setTimeout(done, 20)); });
    }
    assert.fail(`never happened: ${what}`);
  };
  const settled = () => q('[aria-busy=true]') === null;

  /** Mounts the block over the real client; `answer` is the server's reply to a search. */
  const open = async (answer, text) => {
    await close();
    const page = { asked: [], answer };
    const fetch = async request => {
      const url = new URL(request.url);
      const query = url.searchParams.get('q');
      if (query === null && url.searchParams.get('archived') === null) return Response.json({ conversations: listed });
      page.asked.push(query);
      return page.answer(query, request);
    };
    const Host = () => {
      const conversations = useConversationsClient({ endpoint: 'https://fictional.invalid/conversations', fetch, activeId: undefined, onSelect() {}, pollMs: 3_600_000 });
      if (!conversations) return null;
      const list = createElement(ConversationList, { conversations, searchMode: 'inline' });
      return text ? createElement(ChatTextProvider, { value: text }, list) : list;
    };
    root = createRoot(element);
    await act(async () => root.render(createElement(Host)));
    await until(() => rows().length === 2, 'the plain list arrives');
    return page;
  };
  const type = value => act(async () => {
    const input = q('[data-testid=conversation-search]');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  /** Types a query and waits for its search to be asked and answered. */
  const search = async (page, value) => {
    const before = page.asked.length;
    await type(value);
    await until(() => page.asked.length > before && settled(), `the search for ${value} is answered`);
  };

  await t.test('a refused search says it failed, even for a title the list shows', async () => {
    const page = await open(refused);
    await search(page, 'harbour');
    assert.equal(said(), SAID);
    assert.equal(empty(), null, 'not "No conversation matches"');
    assert.deepEqual(rows(), [], 'no row claims to be a result');
    assert.deepEqual(page.asked, ['harbour'], 'the query went to the server as typed: the refusal is not worked around');
  });

  for (const [name, answer] of [
    ['a 500', () => new Response('fictional', { status: 500 })],
    ['a network failure', () => { throw new TypeError('Failed to fetch'); }],
    ['an answer that is not JSON', () => new Response('<html>fictional</html>', { status: 200 })],
  ]) {
    await t.test(`${name} says it failed`, async () => {
      const page = await open(answer);
      await search(page, 'harbour');
      assert.equal(said(), SAID);
      assert.equal(empty(), null);
    });
  }

  await t.test('a failed Archived filter says it failed, not that nothing is archived', async () => {
    const page = await open(refused);
    await act(async () => q('[data-testid=conversations-archived]').click());
    await until(() => page.asked.length === 1 && settled(), 'the archived search is answered');
    assert.equal(said(), SAID);
    assert.equal(empty(), null);
  });

  await t.test('a real no-match keeps its text, with no failure', async () => {
    const page = await open(() => Response.json({ conversations: [] }));
    await search(page, 'nowhere');
    assert.equal(empty(), 'No conversation matches “nowhere”.');
    assert.equal(said(), null);
  });

  await t.test('results are listed as before', async () => {
    const page = await open(() => Response.json({ conversations: [listed[1]] }));
    await search(page, 'lighthouse');
    assert.deepEqual(rows(), ['lighthouse']);
    assert.equal(said(), null);
    assert.equal(empty(), null);
  });

  await t.test('a new query clears the failure while it runs, and runs again', async () => {
    const page = await open(refused);
    await search(page, 'harbour');
    assert.equal(said(), SAID);
    const answer = held();
    page.answer = () => answer.promise;
    await type('lighthouse');
    assert.equal(said(), null, 'the failure leaves as soon as the query changes');
    await until(() => page.asked.includes('lighthouse'), 'the new query is asked');
    answer.resolve(Response.json({ conversations: [listed[1]] }));
    await until(() => rows().length === 1, 'the new result arrives');
    assert.deepEqual(rows(), ['lighthouse']);
    assert.equal(said(), null);
  });

  await t.test('clearing the query after a failure gives the plain list back', async () => {
    const page = await open(refused);
    await search(page, 'harbour');
    assert.equal(said(), SAID);
    await type('');
    assert.deepEqual(rows(), ['harbour', 'lighthouse']);
    assert.equal(said(), null);
    assert.equal(empty(), null);
  });

  await t.test('an aborted search shows nothing', async () => {
    const abortable = (_query, request) => new Promise((_resolve, reject) => { request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); });
    const page = await open(abortable);
    await type('harbour');
    await until(() => page.asked.includes('harbour'), 'the search is asked');
    await type('');
    await act(async () => { await new Promise(done => setTimeout(done, 40)); });
    assert.deepEqual(rows(), ['harbour', 'lighthouse']);
    assert.equal(said(), null, 'leaving the search is not a failure');
    assert.equal(empty(), null);
    await type('lighthouse');
    await until(() => page.asked.includes('lighthouse'), 'the next search is asked');
    await type('harbour');
    await until(() => page.asked.filter(query => query === 'harbour').length === 2, 'the search after it is asked');
    assert.equal(said(), null, 'a query replaced by another is not a failure');
  });

  await t.test('a late refusal of an old query does not cover the newer result', async () => {
    const late = held();
    const page = await open(query => query === 'harbour' ? late.promise : Response.json({ conversations: [listed[1]] }));
    await type('harbour');
    await until(() => page.asked.includes('harbour'), 'the old search is asked');
    await search(page, 'lighthouse');
    assert.deepEqual(rows(), ['lighthouse']);
    await act(async () => { late.resolve(refused()); await new Promise(done => setTimeout(done, 20)); });
    assert.deepEqual(rows(), ['lighthouse']);
    assert.equal(said(), null);
  });

  await t.test('a host says it in its own words, and French has its own', async () => {
    const custom = { ...defaultChatText, labels: { ...defaultChatText.labels, searchFailed: 'Fictional host words' } };
    const page = await open(refused, custom);
    await search(page, 'harbour');
    assert.equal(said(), 'Fictional host words');
    const french = { ...defaultChatText, labels: frenchChatLabels };
    const again = await open(refused, french);
    await search(again, 'port');
    assert.equal(said(), 'La recherche a échoué. Réessayez.');
    assert.equal(empty(), null);
  });
});
