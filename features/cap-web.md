# Web search and page reading (cap-web)

A plain import any app can call, with no Effect, no host and no Worker in between: a web search (Tavily) and a page read (the kit's own reader), each in one call. Every result is marked `untrusted`: web text is evidence to cite, never an instruction and never the person's agreement.

## Sub-features

- `web-search` `search({ query, limit? }, options)` from `@hachej/boring-agent/caps/web`: 1 to 8 results (default 5), each `{ title, url, snippet, published }`; answers `{ ok: true, results, untrusted: true, provider, region, counted }` or `{ ok: false, kind, retryable }`, never a throw. A query is 1 to 400 characters. `packages/agent/src/caps/web/index.ts`.
- `web-fetch` `fetch({ url }, options)` (import it as `fetch as readPage` next to the global): the https page or PDF as markdown, at most 12,000 characters, `truncated` when anything was cut. Refused before any request: http, credentials, an IP or numeric host, a host without a dot, `.local`, `.internal`, `.localhost`. `packages/agent/src/caps/web/guard.ts`.
- `web-reader` the reader: redirects followed by hand (5 at most, each hop checked as a first request), 1.5 MB of a page and 8 MB of a PDF, charset decoded, Readability + linkedom + turndown for HTML, unpdf for PDFs, only the page's own request (no cookie, credential or referrer). The libraries load on the first read. `packages/agent/src/caps/web/reader.ts`.
- `web-providers` `search`: `tavily` (`TAVILY_API_KEY`, region `us`, `SEARCH_USD` = 0.008 per basic search) and `fake`. `fetch`: `reader` (no key, region `global`) and `fake`. A name the call cannot use is refused `web-provider`; a real provider without `options.fetch` is refused `web-no-fetch`. Failover, meter and time limit are the shared call's (`caps/shared.ts`); refusal kinds: `web-url`, `web-query[:400]`, `web-redirect`, `web-page`, `web-type`, `web-too-large:8000000`, `web-empty`, `web-unreadable`, `web-invalid-answer`, `web-failed`, `unavailable`, `timeout`.
- `web-tool` `webTool({ searchProviders, ... })`: the pi-durable tools `web_search` (`{ query, max_results? }`) and `web_fetch` (`{ url }`), closed parameters, replay safe, same names and arguments as the host's `tools: [web]`. Their text holds `note` (`WEB_NOTE`) and `untrusted: true`.

## How to get to it (user POV)

- A person never sees it. Their app's agent looks a price or a rule up and reads the page it found.

## Driving it with the example journeys

Preconditions: `npm run build`; no network and no key needed.

```js
import { search, fetch as readPage, webTool } from "@hachej/boring-agent/caps/web";
const found = await search({ query: "pendulum experiment" }, { providers: ["tavily"], keys: env, fetch });
const page = found.ok && await readPage({ url: found.results[0].url }, { providers: ["reader"], fetch });
const tools = webTool({ searchProviders: ["tavily"], keys: env, fetch });
```

- **Calls and tools.** `web-search`, `web-fetch`, `web-reader`, `web-providers` and `web-tool`: `npm run build && node --test test/packages/agent-caps-web.test.mjs`: Tavily and the pages are a local double (`test/fixtures/caps/web/pages.mjs`); the global `fetch` throws and is never called.
- **Real check.** `vault kv get -mount=secret -field=api_key agent/tavily | node scripts/cap-real/web.mjs`: 5 searches, the first result of each read, and the double's keys compared with a live answer. Without a key: `skipped: no key`.

## Gotchas

- **Workers.** The reader runs in workerd with `compatibilityFlags: []`: no library needs `nodejs_compat` (test "web workerd": esbuild with the `workerd, worker, browser` conditions, run through the pinned wrangler's miniflare).
- The URL guard is lexical (D-56): a public name that resolves to a private address is not caught. On a Node machine the reader reaches that machine's network; an app that needs more passes its own `fetch` that resolves and refuses private addresses.
- Readability drops the heading that repeats the title; the markdown starts with `# <title>` again.
- The old host agents still call `boring-web`; switching them and deleting the Worker is a later step.
