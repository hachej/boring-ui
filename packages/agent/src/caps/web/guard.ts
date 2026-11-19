// What a search or a page read may be asked and what may come back: the URL guard, the input limits and the result builders, ported from
// boring-factory's services/web/port.mjs. Results are built from scratch and marked `untrusted`: web text is evidence, never instructions.
import type { Refusal } from '../shared.js';

export const MAX_RESULTS = 8;
export const DEFAULT_RESULTS = 5;
export const MAX_CHARS = 12_000;
export const MAX_QUERY = 400;
export const MAX_URL = 2048;
export type Result = { title: string; url: string; snippet: string; published: string | null };
export type Found = { results: Result[]; untrusted: true };
export type Page = { url: string; title: string; markdown: string; truncated: boolean; untrusted: true };

export const refuse = (kind: string, retryable = false): Refusal => ({ ok: false, kind, retryable });
const NUMERIC_HOST = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[.*\]|0x[0-9a-f]+|\d+)$/i;
/** The url when a page may be read from it (https, no credentials, a named public host), else null. The guard is lexical on purpose. */
export function secureUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_URL) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || !host.includes('.') || NUMERIC_HOST.test(host) || /\.(?:local|internal|localhost)$/.test(host)) return null;
  return url.href;
}
export const clip = (value: unknown, limit: number): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function admitSearch(input: unknown): { query: string; limit: number } | Refusal {
  const query = clip(isObject(input) && typeof input.query === 'string' ? input.query : '', MAX_QUERY + 1);
  if (!query) return refuse('web-query');
  if (query.length > MAX_QUERY) return refuse(`web-query:${MAX_QUERY}`);
  const n = Number(isObject(input) ? input.limit : undefined);
  return { query, limit: Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), MAX_RESULTS) : DEFAULT_RESULTS };
}
export function admitFetch(input: unknown): { url: string } | Refusal {
  const url = secureUrl(isObject(input) ? input.url : undefined);
  return url ? { url } : refuse('web-url');
}

const dateOf = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v.slice(0, 10))) ? v.slice(0, 10) : null);
export function searchResult(input: { limit: number }, said: unknown): Found {
  const seen = new Set<string>(), results: Result[] = [];
  for (const r of isObject(said) && Array.isArray(said.results) ? said.results : []) {
    const url = secureUrl(r?.url);
    if (!url || seen.has(url) || results.length >= input.limit) continue;
    seen.add(url);
    results.push({ title: clip(r.title, 300) || url, url, snippet: clip(r.snippet, 600), published: dateOf(r.published) });
  }
  return { results, untrusted: true };
}
/** The markdown cut to MAX_CHARS; `truncated` when the page or the reader's size cap cut anything. */
export function pageResult(input: { url: string }, said: unknown): Page | Refusal {
  const s = isObject(said) ? said : {};
  const text = typeof s.markdown === 'string' ? s.markdown.trim() : '';
  if (!text) return refuse('web-empty');
  return { url: secureUrl(s.url) ?? input.url, title: clip(s.title, 300), markdown: text.slice(0, MAX_CHARS), truncated: s.truncated === true || text.length > MAX_CHARS, untrusted: true };
}
