// What extraction refuses before anything is sent, and the check that keeps a field only when its quote is on its page. Ported from
// boring-factory services/extract/port.mjs at 4b5437ab5: `sniff`, `pdfPages`, `inflate`, `schemaOf` and `admit` with a refusal value for each
// `fail` (and a Uint8Array join for the inflated bytes); `squash`, `numberOf`, `valueOf`, `grounded` and `normaliseField` copied with types added
// and nothing else changed; `result`'s field part exported as `checkFields`.
import type { Refusal } from '../shared.js';

export const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_PAGES = 20;
export const MAX_FIELDS = 30;
export const MAX_INFLATED_BYTES = 32 * 1024 * 1024;
export const THRESHOLD = 0.8;
export const FIELD_TYPES = Object.freeze(['string', 'number', 'date', 'amount'] as const);
export type FieldType = (typeof FIELD_TYPES)[number];
export type FieldSchema = Record<string, FieldType | { type: FieldType; description?: string }>;
export type FieldSpec = { readonly name: string; readonly type: FieldType; readonly description?: string };
/** `bytes`: a Uint8Array or the raw bytes behind one. `pages`: 1-based, a PDF only. */
export type Doc = { bytes: Uint8Array | Uint8Array['buffer']; pages?: readonly number[] };
export type Page = { n: number; text: string; confidence: number };
export type Field = { name: string; value: string | number; confidence: number; evidence: { page: number; quote: string } }
  | { name: string; value: null; confidence: 0; evidence: null; reason: 'uncertain' };
/** What a provider (or an app's own model) said about a field: its value and, to be kept, the page and the quote that show it. */
export type Said = { name: string; value: unknown; confidence?: number; page?: number; quote?: string };
export type Admitted = { bytes: Uint8Array; type: string; total: number; read: readonly number[] | null; count: number; schema: readonly FieldSpec[] | null };

const refuse = (kind: string): Refusal => ({ ok: false, kind, retryable: false });
class Limit extends Error {}
const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
/** The type the bytes are, or null. */
export function sniff(b: Uint8Array): string | null {
  if (starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}
const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
const PAGE = /\/Type\s*\/Page(?![A-Za-z])/g;
/** Inflate through a reader, charging `budget.left`; stops reading and throws `Limit` the moment the budget is spent. */
async function inflate(bytes: Uint8Array, budget: { left: number }): Promise<Uint8Array> {
  const reader = new Blob([bytes as never]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      budget.left -= value.byteLength;
      if (budget.left < 0) throw new Limit();
      parts.push(value);
    }
  } finally { reader.cancel().catch(() => {}); }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.byteLength), 0);
  return out;
}
/** A PDF's pages: its page objects, including those inside compressed object streams. 0 when none can be found. */
export async function pdfPages(b: Uint8Array): Promise<number> {
  const text = latin1(b);
  let n = (text.match(PAGE) ?? []).length;
  const STREAM = /<<((?:(?!>>)[\s\S]){0,4000})>>\s*stream\r?\n/g;
  let seen = 0;
  const budget = { left: MAX_INFLATED_BYTES };
  for (const m of text.matchAll(STREAM)) {
    if (++seen > 500) break;
    if (!/\/ObjStm\b/.test(m[1]!) || !/\/FlateDecode\b/.test(m[1]!)) continue;
    const begin = m.index! + m[0].length; const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(m[1]!);
    let end = length ? begin + Number(length[1]) : text.indexOf('endstream', begin);
    if (end < begin || end > b.length) continue;
    if (!length) while (end > begin && (b[end - 1] === 0x0a || b[end - 1] === 0x0d)) end--;
    try { n += (latin1(await inflate(b.subarray(begin, end), budget)).match(PAGE) ?? []).length; } catch (e) { if (e instanceof Limit) throw e; /* not a readable stream: its pages are not counted */ }
  }
  return n;
}
/** Field names and types, at most 30: { name: type } or { name: { type, description } }; a refusal kind otherwise. */
export function schemaOf(schema: unknown): readonly FieldSpec[] | string {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 'extraction-schema';
  const entries = Object.entries(schema);
  if (!entries.length || entries.length > MAX_FIELDS) return `extraction-fields:${MAX_FIELDS}`;
  const out: FieldSpec[] = [];
  for (const [field, spec] of entries) {
    const type = typeof spec === 'string' ? spec : spec?.type;
    const description = typeof spec === 'object' && spec ? spec.description : undefined;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field) || !FIELD_TYPES.includes(type) || (description !== undefined && (typeof description !== 'string' || description.length > 300))) return 'extraction-schema';
    out.push(Object.freeze({ name: field, type, ...(description ? { description } : {}) }));
  }
  return out;
}
/** What a provider may be sent: checked whole before anything is sent. `read` is the asked pages (a PDF), `count` the pages charged. */
export async function admit(doc: Doc, schema?: unknown): Promise<Admitted | Refusal> {
  const fields = schema === undefined ? null : schemaOf(schema);
  if (typeof fields === 'string') return refuse(fields);
  const raw = doc?.bytes, b = raw instanceof Uint8Array ? raw : raw && typeof raw.byteLength === 'number' ? new Uint8Array(raw) : null;
  if (!b || !b.byteLength) return refuse('extraction-empty');
  if (b.byteLength > MAX_BYTES) return refuse(`extraction-too-large:${MAX_BYTES}`);
  const type = sniff(b);
  if (!type) return refuse('extraction-type');
  const asked = doc.pages;
  if (type !== 'application/pdf') return asked === undefined ? { bytes: b, type, total: 1, read: null, count: 1, schema: fields } : refuse('extraction-pages-asked');
  if (/\/Encrypt\b/.test(latin1(b))) return refuse('extraction-encrypted');
  let total: number;
  try { total = await pdfPages(b); } catch { return refuse(`extraction-inflated:${MAX_INFLATED_BYTES}`); }
  if (!total) return refuse('extraction-unreadable');
  if (asked !== undefined && (!Array.isArray(asked) || !asked.length || asked.some((n) => !Number.isInteger(n) || n < 1 || n > total))) return refuse('extraction-pages-asked');
  const read = asked === undefined ? null : [...new Set(asked)].sort((x, y) => x - y);
  const count = read ? read.length : total;
  if (count > MAX_PAGES) return refuse(`extraction-pages:${MAX_PAGES}`);
  return { bytes: b, type, total, read, count, schema: fields };
}

// ------------------------------------------------------------------------------- values (EXTRACT-3), copied with types added
const squash = (s: unknown) => String(s).normalize('NFKC').replace(/[|*#_`>]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
/** A number written "1 234,56", "1,234.56", "1234.5" or 1234.56; an ambiguous one ("1.234") is null, never guessed. */
export function numberOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[\s  ]/g, '').replace(/[€$£]|EUR|USD|GBP|CHF/gi, '');
  if (!/^[-+]?[\d.,']+$/.test(s)) return null;
  s = s.replace(/'/g, '');
  const last = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (last >= 0) {
    const tail = s.length - last - 1; const separators = (s.match(/[.,]/g) ?? []).length;
    if (separators === 1 && tail === 3) return null;
    s = s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1);
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function valueOf(type: FieldType, v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (type === 'string') return typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null;
  if (type === 'number') return numberOf(v);
  if (type === 'amount') { const n = numberOf(v); return n === null ? null : Math.round(n * 100) / 100; }
  if (type === 'date') {
    const m = typeof v === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    const d = m && new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
    return m && d && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]! ? v as string : null;
  }
  return null;
}
type Evidence = { page?: unknown; quote?: unknown } | null | undefined;
/** The quote is on its page and supports the complete value, not just some matching digits. */
function grounded(field: FieldSpec, value: string | number, evidence: Evidence, pages: readonly Page[]): boolean {
  const page = pages.find((p) => p.n === evidence?.page);
  const quote = typeof evidence?.quote === 'string' ? evidence.quote : '';
  if (!page || !quote.trim() || quote.length > 300 || !squash(page.text).includes(squash(quote))) return false;
  if (field.type === 'string') return Boolean(squash(value)) && squash(quote).includes(squash(value));
  if (field.type === 'date') {
    const [year, month, day] = (value as string).split('-').map(Number);
    for (const m of quote.matchAll(/\b(?:(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}))\b/g)) {
      if (m[1] && +m[1] === year && +m[2]! === month && +m[3]! === day) return true;
      if (m[4] && (+m[4] > 12 || +m[4] === +m[5]!) && +m[6]! === year && +m[5]! === month && +m[4] === day) return true;
    }
    return false;
  }
  const printed = quote.replace(/[€$£]|EUR|USD|GBP|CHF/gi, '').replace(/[−–]/g, '-');
  for (const m of printed.matchAll(/[-+(]?\s*\d[\d \t  .,']*[-+)]?/g)) {
    const token = m[0].trim();
    const accounting = token.startsWith('(') && token.endsWith(')');
    const number = numberOf(accounting ? token.slice(1, -1) : token);
    if (number !== null && (accounting ? -number : number) === value) return true;
  }
  return false;
}
const uncertainField = (name: string): Field => Object.freeze({ name, value: null, confidence: 0, evidence: null, reason: 'uncertain' as const });
/** One requested field from what the adapter said: a confident value with evidence on the page, else null "uncertain". */
export function normaliseField(field: FieldSpec, said: { value?: unknown; confidence?: unknown; evidence?: Evidence } | undefined, pages: readonly Page[], threshold: number): Field {
  const value = valueOf(field.type, said?.value);
  const confidence = said?.confidence;
  if (value === null || typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1) || confidence < threshold) return uncertainField(field.name);
  if (!grounded(field, value, said!.evidence, pages)) return uncertainField(field.name);
  return Object.freeze({ name: field.name, value, confidence, evidence: Object.freeze({ page: said!.evidence!.page as number, quote: (said!.evidence!.quote as string).trim() }) });
}

/** A provider's page, kept only when its number is one the document has; the text capped at 200,000 characters. */
export const pageOf = (p: { n?: unknown; text?: unknown; confidence?: unknown } | null | undefined, max: number): Page | null => (Number.isInteger(p?.n) && (p!.n as number) >= 1 && (p!.n as number) <= max && typeof p!.text === 'string'
  ? Object.freeze({ n: p!.n as number, text: p!.text.slice(0, 200_000), confidence: typeof p!.confidence === 'number' && p!.confidence >= 0 && p!.confidence <= 1 ? p!.confidence : 0 })
  : null);
/**
 * The field check on its own, no provider call: each field of `schema` from what was said about it, kept only when its value parses,
 * its confidence (the field's, else its page's) is at least 0.8 and its quote is on its page and supports the whole value.
 */
export function checkFields(schema: FieldSchema, pages: readonly Page[], said: readonly Said[]): Field[] {
  const specs = schemaOf(schema);
  if (typeof specs === 'string') throw new TypeError(`checkFields: ${specs}`);
  const by = new Map((Array.isArray(said) ? said : []).filter((f) => typeof f?.name === 'string').map((f) => [f.name, f]));
  return specs.map((f) => {
    const s = by.get(f.name);
    const confidence = s?.confidence ?? pages.find((p) => p.n === s?.page)?.confidence;
    return normaliseField(f, s && { value: s.value, confidence, evidence: { page: s.page, quote: s.quote } }, pages, THRESHOLD);
  });
}
