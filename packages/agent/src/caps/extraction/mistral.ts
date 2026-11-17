// Mistral OCR (POST https://api.mistral.ai/v1/ocr, docs.mistral.ai/api/endpoint/ocr, read 2026-11-17), through the app's own `fetch`.
// Region eu. Text: one OCR call with page confidence scores; fields: the same call with a document annotation (a JSON schema) that asks
// each field's value, page and printed quote. Mistral gives no confidence per field, so a field's is its page's. Ported from
// boring-factory services/extract/adapters/mistral, plus Mistral's `pages` (0-based) and the invalid-answer refusal.
import type { Refusal } from '../shared.js';
import type { Admitted, Page, Said } from './port.js';

const ENDPOINT = 'https://api.mistral.ai/v1/ocr';
const MODEL = 'mistral-ocr-latest';
/** USD per page charged by the ledger: OCR alone, OCR with a document annotation. The card's figures (Mistral's pricing page gives none). */
export const PAGE_USD = { text: 0.002, fields: 0.003 } as const;
const base64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const JSON_TYPE = { string: 'string', date: 'string', number: 'number', amount: 'number' } as const;
const HINT = { date: 'the date as YYYY-MM-DD', amount: 'the amount as a number, without currency', number: 'a number', string: 'the text' } as const;
const PROMPT = 'Fill a field only when the document prints it. For each field give the page it is on and copy, as printed, the text that shows it. When a field is absent, unreadable or ambiguous, set value, page and quote to null. Never guess.';
const squash = (s: unknown) => String(s).normalize('NFKC').replace(/[|*#_`>]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

function bodyOf(input: Admitted) {
  const url = `data:${input.type};base64,${base64(input.bytes)}`;
  const document = input.type === 'application/pdf' ? { type: 'document_url', document_url: url } : { type: 'image_url', image_url: url };
  const body: Record<string, unknown> = { model: MODEL, document, include_image_base64: false, confidence_scores_granularity: 'page', ...(input.read && { pages: input.read.map((n) => n - 1) }) };
  if (input.schema) Object.assign(body, {
    document_annotation_prompt: PROMPT,
    document_annotation_format: { type: 'json_schema', json_schema: { name: 'fields', strict: true, schema: {
      type: 'object', additionalProperties: false, required: input.schema.map((f) => f.name),
      properties: Object.fromEntries(input.schema.map((f) => [f.name, {
        type: 'object', additionalProperties: false, required: ['value', 'page', 'quote'], description: [f.description, HINT[f.type]].filter(Boolean).join('; '),
        properties: { value: { type: [JSON_TYPE[f.type], 'null'] }, page: { type: ['integer', 'null'], description: 'the page it is printed on, from 1' }, quote: { type: ['string', 'null'], description: 'the exact text of the document that shows the value, copied as printed' } },
      }])),
    } } },
  });
  return body;
}
function pagesOf(response: { pages: unknown[] }): Page[] {
  return response.pages.map((p: any) => ({ n: Number.isInteger(p?.index) ? p.index + 1 : NaN, text: typeof p?.markdown === 'string' ? p.markdown : '', confidence: p?.confidence_scores?.average_page_confidence_score ?? null }));
}
function fieldsOf(response: { document_annotation?: unknown }, input: Admitted, pages: Page[]): Said[] {
  let annotation: any = {};
  try { annotation = typeof response.document_annotation === 'string' ? JSON.parse(response.document_annotation) : (response.document_annotation ?? {}); } catch { annotation = {}; }
  return input.schema!.map((f) => {
    const a = annotation?.[f.name];
    if (!a || a.value === null || a.value === undefined || typeof a.quote !== 'string') return { name: f.name, value: null };
    // The page Mistral named, unless the quote is on exactly one other page.
    const on = pages.filter((p) => squash(p.text).includes(squash(a.quote)));
    const page = on.some((p) => p.n === a.page) ? a.page : on.length === 1 ? on[0]!.n : a.page;
    return { name: f.name, value: a.value, page, quote: a.quote };
  });
}

/** One reading. A failed request throws (`key` when Mistral refused the key), so the next listed provider is tried; an answer that is not Mistral's JSON is a refusal. */
export async function mistral(input: Admitted, key: string, signal: AbortSignal, fetch: typeof globalThis.fetch, charge: (micros: number) => Promise<void>): Promise<{ pages: Page[]; said?: Said[] } | Refusal> {
  const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(bodyOf(input)), signal });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(response.status === 401 || response.status === 403 ? 'key' : 'down');
  }
  await charge(Math.round(input.count * PAGE_USD[input.schema ? 'fields' : 'text'] * 1_000_000));
  let json: any;
  try { json = await response.json(); } catch { json = undefined; }
  if (!json || typeof json !== 'object' || !Array.isArray(json.pages)) return { ok: false, kind: 'extraction-invalid-answer', retryable: false };
  const pages = pagesOf(json);
  return { pages, ...(input.schema && { said: fieldsOf(json, input, pages) }) };
}
