// Tavily search (https://docs.tavily.com/documentation/api-reference/endpoint/search): the query goes to Tavily in the US.
import { usageOf } from '../shared.js';
import type { Charge } from '../shared.js';
import { refuse } from './guard.js';
import type { Refusal } from '../shared.js';

/** USD for one basic search: 1 credit at 0.008 USD (Tavily's pay-as-you-go price, checked 2026-11-19). */
export const SEARCH_USD = 0.008;

/** The provider's answer, or a refusal when it is not JSON. A failure throws `key` (a key or plan problem, 401 403 432 433, or any other 4xx: try the next) or `down` (429, 5xx: retry later). */
export async function tavily(input: { query: string; limit: number }, key: string, signal: AbortSignal, fetcher: typeof fetch, record: (charge: Charge) => Promise<void>): Promise<unknown | Refusal> {
  const response = await fetcher('https://api.tavily.com/search', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, signal,
    body: JSON.stringify({ query: input.query, max_results: input.limit, search_depth: 'basic', include_answer: false, include_raw_content: false, include_images: false }),
  });
  if (!response.ok) {
    await response.body?.cancel?.();
    throw new Error(response.status === 429 || response.status >= 500 ? 'down' : 'key');
  }
  await record({ bucket: 'tool:web-search', usage: usageOf(SEARCH_USD), amountMicros: Math.round(SEARCH_USD * 1_000_000) });
  let body: { results?: { title?: unknown; url?: unknown; content?: unknown; published_date?: unknown }[] };
  try { body = await response.json(); } catch { return refuse('web-invalid-answer'); }
  return { results: (Array.isArray(body?.results) ? body.results : []).map((r) => ({ title: r?.title, url: r?.url, snippet: r?.content, published: r?.published_date })) };
}
