// The privacy canary kit (FEEDBACK.md, "The canary kit"; FEEDBACK-8). It plants fictional canaries in every channel the policy must
// mask or drop, runs the caller's real path, and scans every output string after HTML-entity and percent decoding.
import type { RouteLocation } from './privacy/policy.js';
import { FEEDBACK_VISIBLE_ATTRIBUTE } from './privacy/policy.js';

/** Every planted channel. `visible-*` channels sit inside a `data-feedback-visible` region and must stay masked there too. */
export const CANARY_CHANNELS = Object.freeze([
  'text', 'text-entity', 'text-percent', 'labelled-by',
  'id', 'class', 'title', 'title-entity', 'alt', 'aria-label', 'aria-description', 'data-attribute', 'kept-digits', 'kept-at', 'style', 'event-handler',
  'href-path', 'href-percent', 'href-query', 'href-fragment', 'src', 'form-action',
  'input-value', 'input-live-value', 'placeholder', 'button-value', 'textarea', 'textarea-live-value', 'select-value', 'select-text', 'contenteditable',
  'visible-input-value', 'visible-placeholder', 'visible-textarea', 'visible-select-text', 'visible-contenteditable',
  'document-title', 'route-segment', 'route-percent', 'route-query', 'route-fragment',
] as const);

export type CanaryChannel = (typeof CANARY_CHANNELS)[number];

/** The marker on the planted section, so callers and tests can find it. */
export const CANARY_SECTION_ATTRIBUTE = 'data-feedback-canaries';

/** Default tokens: unique per channel, none a prefix of another, no digit run or `@` (so the digit rule never hides a leak). */
export function defaultCanaries(): Readonly<Record<CanaryChannel, string>> {
  return Object.freeze(Object.fromEntries(CANARY_CHANNELS.map(channel => [channel, `xq${channel.replace(/-/g, '')}vz`])) as Record<CanaryChannel, string>);
}

export interface CanaryPage {
  readonly document: Document;
  /** Where the canary section is appended; defaults to `document.body`. Put it where the application's data would live. */
  readonly root?: Element;
}

export interface CanaryRun {
  readonly document: Document;
  /** The planted section. */
  readonly root: Element;
  /** A location with canaries in path segments, query and fragment, for the route channel. */
  readonly location: RouteLocation;
}

export interface CanaryHit {
  readonly channel: CanaryChannel;
  readonly token: string;
  /** Where in the output it was found, as a JSON-path-like string (`$.report.observed.subject.route`). */
  readonly output: string;
}

export interface CanaryResult {
  /** False when any canary was found. */
  readonly ok: boolean;
  readonly hits: readonly CanaryHit[];
  readonly channels: readonly CanaryChannel[];
  readonly scanned: number;
}

export interface PrivacyCanaryOptions {
  readonly page: CanaryPage;
  /** Token per channel; defaults to `defaultCanaries()`. Tokens must be fictional. */
  readonly canaries?: Partial<Readonly<Record<CanaryChannel, string>>>;
  /** The caller's real path (serializer, picker label, report, Copy...). Its return value is scanned; so are strings it passes to `emit`. */
  readonly run: (context: CanaryRun, emit: (label: string, output: unknown) => void) => unknown;
}

const percentEncode = (token: string): string => `%${token.charCodeAt(0).toString(16)}${token.slice(1)}`;
// Hexadecimal entity and two-digit percent forms: a three-digit decimal entity would be hidden by the digit rule, not by the policy.
const entityEncode = (token: string): string => `&#x${token.charCodeAt(0).toString(16)};${token.slice(1)}`;

function plant(document: Document, tokens: Readonly<Record<CanaryChannel, string>>): Element {
  const make = (tag: string, attributes: Readonly<Record<string, string>> = {}, text?: string): Element => {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    if (text !== undefined) element.append(document.createTextNode(text));
    return element;
  };
  const t = tokens;
  const section = make('section', { [CANARY_SECTION_ATTRIBUTE]: '', role: 'region' });
  const text = make('p', { 'data-testid': 'canary-text' }, `Fictional ${t.text} record`);
  text.setAttribute('id', t.id);
  section.append(
    text,
    make('p', {}, entityEncode(t['text-entity'])),
    make('p', {}, percentEncode(t['text-percent'])),
    make('span', { id: 'feedback-canary-labelled' }, t['labelled-by']),
    make('button', { type: 'button', 'aria-labelledby': 'feedback-canary-labelled' }),
    make('div', {
      class: `card ${t.class}`, title: t.title, 'aria-label': t['aria-label'], 'aria-description': t['aria-description'], 'data-record': t['data-attribute'],
      'data-testid': `${t['kept-digits']}-4711`, 'data-feedback-id': `${t['kept-at']}@fictional.invalid`, style: `background:url(${t.style})`, onclick: `alert('${t['event-handler']}')`,
    }, 'Card'),
    make('span', { title: entityEncode(t['title-entity']) }, 'Entity title'),
    make('img', { src: `/images/${t.src}.png`, alt: t.alt }),
    make('a', { href: `/records/${t['href-path']}?q=${t['href-query']}#${t['href-fragment']}` }, 'Open'),
    make('a', { href: `/records/${percentEncode(t['href-percent'])}` }, 'Open encoded'),
  );
  const form = make('form', { action: `/submit/${t['form-action']}` });
  const input = make('input', { type: 'text', value: t['input-value'], placeholder: t.placeholder }) as HTMLInputElement;
  const live = make('input', { type: 'text' }) as HTMLInputElement;
  live.value = t['input-live-value'];
  const textarea = make('textarea', {}, t.textarea) as HTMLTextAreaElement;
  const liveArea = make('textarea', {}) as HTMLTextAreaElement;
  liveArea.value = t['textarea-live-value'];
  const select = make('select');
  select.append(make('option', { value: t['select-value'], selected: '' }, t['select-text']));
  form.append(input, live, make('input', { type: 'submit', value: t['button-value'] }), textarea, liveArea, select, make('div', { contenteditable: 'true' }, t.contenteditable));
  const visible = make('div', { [FEEDBACK_VISIBLE_ATTRIBUTE]: '' });
  const visibleSelect = make('select', { 'aria-label': 'Fictional choice' });
  visibleSelect.append(make('option', {}, t['visible-select-text']));
  visible.append(
    make('h3', {}, 'Visible fictional region'),
    make('label', { for: 'feedback-canary-visible-input' }, 'Visible label'),
    make('input', { id: 'feedback-canary-visible-input', type: 'text', value: t['visible-input-value'], placeholder: t['visible-placeholder'] }),
    make('textarea', { 'aria-label': 'Fictional notes' }, t['visible-textarea']),
    visibleSelect,
    make('div', { contenteditable: 'plaintext-only' }, t['visible-contenteditable']),
  );
  section.append(form, visible);
  return section;
}

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeOnce(value: string): string[] {
  const entities = value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Math.min(parseInt(dec, 10), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED[name.toLowerCase()] ?? match);
  const percent = value.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return [entities, percent];
}

/** The string and its HTML-entity and percent decodings (combined, up to three rounds), lower-cased. */
function decodings(value: string): Set<string> {
  let frontier = new Set([value]);
  const all = new Set([value.toLowerCase()]);
  for (let round = 0; round < 3 && frontier.size; round++) {
    const next = new Set<string>();
    for (const item of frontier) for (const decoded of decodeOnce(item)) if (!all.has(decoded.toLowerCase())) { all.add(decoded.toLowerCase()); next.add(decoded); }
    frontier = next;
  }
  return all;
}

function strings(value: unknown, path: string, out: { path: string; value: string }[], seen: Set<object>): void {
  if (typeof value === 'string') { out.push({ path, value }); return; }
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) { value.forEach((item, index) => strings(item, `${path}[${index}]`, out, seen)); return; }
  if (value instanceof Map) { for (const [key, item] of value) { strings(key, `${path}.<key>`, out, seen); strings(item, `${path}.${String(key)}`, out, seen); } return; }
  for (const [key, item] of Object.entries(value)) { out.push({ path: `${path}.<key ${key}>`, value: key }); strings(item, `${path}.${key}`, out, seen); }
}

/**
 * Plants canaries under `page.root`, sets the document title to a canary, runs `run` with a canary location, then restores the page and
 * scans the returned value and every emitted output. Each hit names its channel and the output it appeared in.
 */
export async function runPrivacyCanaries({ page, canaries, run }: PrivacyCanaryOptions): Promise<CanaryResult> {
  const tokens = { ...defaultCanaries(), ...canaries } as Readonly<Record<CanaryChannel, string>>;
  const { document } = page;
  const parent = page.root ?? document.body;
  const section = plant(document, tokens);
  const title = document.title;
  const location: RouteLocation = Object.freeze({
    pathname: `/records/${tokens['route-segment']}/${percentEncode(tokens['route-percent'])}`,
    search: `?q=${tokens['route-query']}`,
    hash: `#${tokens['route-fragment']}`,
  });
  const outputs: { path: string; value: string }[] = [];
  const emit = (label: string, output: unknown): void => strings(output, `$${label ? `.${label}` : ''}`, outputs, new Set());
  parent.append(section);
  document.title = tokens['document-title'];
  try { emit('result', await run(Object.freeze({ document, root: section, location }), emit)); }
  finally { section.remove(); document.title = title; }
  const hits: CanaryHit[] = [];
  for (const { path, value } of outputs) {
    const decoded = decodings(value);
    for (const channel of CANARY_CHANNELS) {
      const token = tokens[channel].toLowerCase();
      for (const candidate of decoded) if (candidate.includes(token)) { hits.push(Object.freeze({ channel, token: tokens[channel], output: path })); break; }
    }
  }
  return Object.freeze({ ok: hits.length === 0, hits: Object.freeze(hits), channels: CANARY_CHANNELS, scanned: outputs.length });
}
