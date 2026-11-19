#!/usr/bin/env node
// The optional real check of `search` and `fetch` (card cap-web AC-18). The key comes from standard input, never from an argument or the
// environment, and is printed nowhere:
//   vault kv get -mount=secret -field=api_key agent/tavily | node scripts/cap-real/web.mjs
// Five searches on public topics, the first result of each read with the reader through Node's real `fetch`; per query: results, first url,
// page title, markdown length, `truncated`, time. It passes when 4 of 5 searches give a result and 3 of 5 pages give 500 characters or more.
import { readFileSync } from 'node:fs';
import { fetch as readPage, search } from '@hachej/boring-agent/caps/web';
import { KEY, TAVILY_RESULTS, webDouble } from '../../test/fixtures/caps/web/pages.mjs';

const key = process.stdin.isTTY ? '' : readFileSync(0, 'utf8').trim();
if (!key) { console.log('skipped: no key'); process.exit(0); }
const queries = ['pendulum period formula', 'TVA taux réduit restauration', 'how does a mechanical watch work', 'délai de prescription action en justice', 'boiling point of water at altitude'];
const options = { keys: { TAVILY_API_KEY: key }, fetch: (...args) => fetch(...args) };
let withResults = 0, withPages = 0;
for (const query of queries) {
  const started = Date.now(), found = await search({ query }, { ...options, providers: ['tavily'] });
  const first = found.ok ? found.results[0] : undefined;
  const page = first ? await readPage({ url: first.url }, { ...options, providers: ['reader'] }) : undefined;
  if (first) withResults += 1;
  if (page?.ok && page.markdown.length >= 500) withPages += 1;
  console.log([query, `results ${found.ok ? found.results.length : found.kind}`, first?.url ?? '-', page?.ok ? page.title : page?.kind ?? '-', `markdown ${page?.ok ? page.markdown.length : 0}`, `truncated ${page?.ok ? page.truncated : '-'}`, `${Date.now() - started} ms`].join(' | '));
}
const live = await (await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ query: queries[0], max_results: 2, search_depth: 'basic', include_answer: false, include_raw_content: false, include_images: false }) })).json();
const double = webDouble(), recorded = await (await double.fetch('https://api.tavily.com/search', { body: JSON.stringify({ query: queries[0], max_results: 2 }) })).json();
const diff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !(k in a) || !(k in b));
const differing = [...diff(live, recorded).map((k) => `answer.${k}`), ...diff(live.results?.[0] ?? {}, TAVILY_RESULTS[0]).filter((k) => k !== 'published_date').map((k) => `result.${k}`)];
console.log(differing.length ? `double differs: ${differing.join(', ')}` : 'double matches');
const passed = withResults >= 4 && withPages >= 3;
console.log(passed ? 'pass' : `fail: ${withResults}/5 searches, ${withPages}/5 pages`);
process.exit(passed ? 0 : 1);
