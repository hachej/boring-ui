import type { Anchor, AnchorResolution, Placement } from './contracts.js';

/** Offsets address the canonical Markdown string in UTF-16, never rendered text. */
export interface MarkdownQuoteRange { readonly start: number; readonly end: number }
export interface MarkdownQuoteAnchor extends Anchor {
  readonly kind: 'markdown.quote@1';
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly start: number;
  readonly fallback: string;
}

const boundary = (text: string, at: number) => !(at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]!) && /[\uDC00-\uDFFF]/.test(text[at]!));
const offset = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function parse(value: unknown): MarkdownQuoteAnchor {
  if (!value || typeof value !== 'object') throw new TypeError('Expected Markdown quote anchor');
  const a = value as Record<string, unknown>;
  if (a['kind'] !== 'markdown.quote@1' || typeof a['exact'] !== 'string' || !a['exact'] || typeof a['prefix'] !== 'string'
    || typeof a['suffix'] !== 'string' || !offset(a['start']) || typeof a['fallback'] !== 'string' || !a['fallback'].trim()) throw new TypeError('Invalid Markdown quote anchor');
  return { kind: 'markdown.quote@1', exact: a['exact'], prefix: a['prefix'], suffix: a['suffix'], start: a['start'], fallback: a['fallback'] };
}

export function captureMarkdownQuote(source: string, range: MarkdownQuoteRange): { readonly kind: 'captured'; readonly anchor: MarkdownQuoteAnchor } | { readonly kind: 'refused'; readonly reason: string } {
  if (!offset(range.start) || !offset(range.end) || range.end <= range.start || range.end > source.length || !boundary(source, range.start) || !boundary(source, range.end)) return { kind: 'refused', reason: 'Select a nonempty canonical source range' };
  const exact = source.slice(range.start, range.end);
  return { kind: 'captured', anchor: { kind: 'markdown.quote@1', exact, prefix: source.slice(Math.max(0, range.start - 32), range.start), suffix: source.slice(range.end, range.end + 32), start: range.start, fallback: exact } };
}

export const markdownQuoteResolution: AnchorResolution<MarkdownQuoteAnchor, string, MarkdownQuoteRange> = {
  kind: 'markdown.quote@1',
  schema: { jsonSchema: { type: 'object', properties: { kind: { const: 'markdown.quote@1' }, exact: { type: 'string', minLength: 1 }, prefix: { type: 'string' }, suffix: { type: 'string' }, start: { type: 'integer', minimum: 0 }, fallback: { type: 'string', minLength: 1 } }, required: ['kind', 'exact', 'prefix', 'suffix', 'start', 'fallback'], additionalProperties: false }, parse },
  fallback: anchor => anchor.fallback,
  resolve: (anchor, source, evaluated): Placement<MarkdownQuoteRange> => {
    if (anchor.kind !== 'markdown.quote@1') return { kind: 'unsupported', evaluated };
    const a = parse(anchor), matches: MarkdownQuoteRange[] = [];
    for (let at = source.indexOf(a.exact); at !== -1; at = source.indexOf(a.exact, at + 1)) {
      if (boundary(source, at) && boundary(source, at + a.exact.length)) matches.push({ start: at, end: at + a.exact.length });
    }
    if (!matches.length) return { kind: 'missing', evaluated };
    const contextual = matches.filter(r => source.slice(Math.max(0, r.start - a.prefix.length), r.start) === a.prefix && source.slice(r.end, r.end + a.suffix.length) === a.suffix);
    const candidates = contextual.length ? contextual : matches;
    if (candidates.length !== 1) return { kind: 'ambiguous', candidates, evaluated };
    const range = candidates[0]!;
    return { kind: range.start === a.start ? 'exact' : 'moved', range, evaluated };
  },
};

