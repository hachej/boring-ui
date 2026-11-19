// Fictional web for the cap-web tests, ported from boring-factory services/web (adapters/*/fixture.mjs and fixtures/double.mjs): the pendulum
// pages of physique.example.test, a Tavily answer in its documented shape (not a live recording), and a local double of the web that
// records every request (url, method, redirect, headers, referrer policy) and whether it was aborted. The PDF is the extraction fixtures' `pdf()`.
import { pdf } from '../extraction/documents.mjs';

const page = (title, paragraphs) => `<!doctype html><html><head><title>${title}</title><script>alert('never read')</script></head><body><nav>Menu Accueil Contact</nav><article><h1>${title}</h1>${paragraphs.map((p) => `<p>${p}</p>`).join('')}<p>Read <a href="/next">the next page</a>.</p></article><footer>Footer text</footer></body></html>`;
const sentence = 'A mass on a string swings back and forth with a regular period. ';
export const PAGES = {
  page: page('The pendulum experiment', [sentence.repeat(6), 'Measure the period with a stopwatch.']),
  big: page('A very long page', Array.from({ length: 400 }, (_, i) => `${sentence}Paragraph ${i}.`)),
  empty: '<!doctype html><html><head><title>Nothing</title></head><body></body></html>',
};
const enc = new TextEncoder();
const latin = () => {
  const bytes = [];
  for (const part of ['<html><head><title>Caf', 0xe9, '</title></head><body><article><p>Le caf', 0xe9, ` de la physique. ${'Un texte assez long pour la lecture. '.repeat(20)}</p></article></body></html>`]) bytes.push(...(typeof part === 'number' ? [part] : enc.encode(part)));
  return new Uint8Array(bytes);
};
const reply = (body, type, status = 200) => new Response(body, { status, headers: { 'content-type': type } });
const html = (body) => reply(body, 'text/html; charset=utf-8');
const redirect = (location, status = 302) => new Response(null, { status, headers: { location } });
/** A body of `size` bytes in 64 KB chunks; `state.cancelled` says whether the reader gave up on it. */
export function streamed(size, type, state, head = '') {
  let sent = 0;
  const body = new ReadableStream({
    pull(controller) { const n = Math.min(65_536, size - sent); const chunk = new Uint8Array(n).fill(120); if (!sent) chunk.set(enc.encode(head)); sent += n; controller.enqueue(chunk); if (sent >= size) controller.close(); },
    cancel() { state.cancelled = true; },
  });
  return reply(body, type);
}

export const TAVILY_RESULTS = [
  { title: 'The pendulum experiment, explained', url: 'https://physique.example.test/pendulum', content: 'A mass on a string swings with a period that depends on its length.', score: 0.91, published_date: '2026-03-02T00:00:00Z' },
  { title: 'Gravity at home', url: 'https://labo.example.test/gravity', content: 'Measure g with a stopwatch and a thread.', score: 0.74 },
  { title: 'Not an https result', url: 'http://old.example.test/page', content: 'dropped by the cap', score: 0.5 },
  { title: 'One more', url: 'https://labo.example.test/more', content: 'A fourth result.', score: 0.4 },
];
export const KEY = 'tvly-test-NOT-A-REAL-KEY-0001';

/**
 * The web double. `extra`: routes tried first, `[prefix, (init, url) => Response | object]`. `tavily`: the status Tavily answers (200 gives its results).
 * Mode "error" answers 401 to everything and echoes the request's authorization header, the worst a provider could do.
 */
export function webDouble({ extra = [], tavily = 200, mode } = {}) {
  const calls = [], state = { cancelled: false };
  const host = 'https://physique.example.test/';
  const routes = [
    ...extra,
    ['https://api.tavily.com/search', (init) => tavily === 200 ? { query: JSON.parse(init.body).query, results: TAVILY_RESULTS.slice(0, JSON.parse(init.body).max_results + 1) } : reply('nope', 'text/plain', tavily)],
    [`${host}page`, () => html(PAGES.page)],
    [`${host}big`, () => html(PAGES.big)],
    [`${host}empty`, () => html(PAGES.empty)],
    [`${host}latin`, () => reply(latin(), 'text/html; charset=iso-8859-1')],
    [`${host}plain`, () => reply('Just some plain text.', 'text/plain')],
    [`${host}doc.pdf`, () => reply(pdf([['Fictional PDF about pendulums']]), 'application/pdf')],
    [`${host}bad.pdf`, () => reply('this is not a pdf', 'application/pdf')],
    [`${host}huge.pdf`, () => streamed(8_200_000, 'application/pdf', state)],
    [`${host}huge`, () => streamed(1_600_000, 'text/html', state, '<html><head><title>Huge</title></head><body><article><p>')],
    [`${host}image`, () => streamed(70_000, 'image/gif', state)],
    [`${host}gone`, () => reply('gone', 'text/plain', 410)],
    [`${host}down`, () => reply('down', 'text/plain', 503)],
    [`${host}busy`, () => reply('busy', 'text/plain', 429)],
    [`${host}moved`, () => redirect('/page', 301)],
    [`${host}to-http`, () => redirect('http://physique.example.test/page')],
    [`${host}to-local`, () => redirect('https://127.0.0.1/admin')],
    [`${host}to-internal`, () => redirect('https://service.internal./page')],
    [`${host}loop`, () => redirect('/loop')],
    [`${host}slow`, (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))],
  ];
  const fetcher = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', redirect: init.redirect, headers: init.headers ?? {}, referrerPolicy: init.referrerPolicy, aborted: false, body: init.body };
    calls.push(call);
    init.signal?.addEventListener('abort', () => { call.aborted = true; });
    if (mode === 'error') return reply(`echo ${init.headers?.authorization ?? ''}`, 'text/plain', 401);
    const route = routes.find(([prefix]) => String(url).startsWith(prefix));
    if (!route) return reply('not recorded', 'text/plain', 404);
    const answer = await route[1](init, String(url));
    return answer instanceof Response ? answer : Response.json(answer);
  };
  return { calls, state, fetch: fetcher };
}
