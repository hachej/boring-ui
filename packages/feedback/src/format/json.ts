// Strict JSON for `feedback@1` front matter: an RFC 8259 scanner that refuses duplicate keys and bounds
// depth while it reads, and a canonical writer with explicit key order. Pure: no I/O, no platform API.

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export interface JsonObject { readonly [key: string]: JsonValue }

export type ScanResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly code: 'syntax' | 'duplicate-key' | 'depth'; readonly message: string };

class ScanError extends Error {
  constructor(readonly code: 'syntax' | 'duplicate-key' | 'depth', message: string) { super(message); }
}

const ESCAPES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

/** Parse one JSON text. Depth counts containers: a top-level object is depth 1. */
export function scanJson(text: string, maxDepth: number): ScanResult {
  let at = 0;
  const fail = (message: string): never => { throw new ScanError('syntax', `${message} at offset ${at}`); };
  const space = () => { while (at < text.length && ' \t\n\r'.includes(text[at]!)) at++; };
  const string = (): string => {
    at++;
    let out = '';
    for (;;) {
      if (at >= text.length) fail('Unterminated string');
      const char = text[at]!;
      if (char === '"') { at++; break; }
      if (char < ' ') fail('Control character in string');
      if (char !== '\\') { out += char; at++; continue; }
      const next = text[at + 1];
      if (next === 'u') {
        const hex = text.slice(at + 2, at + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid unicode escape');
        out += String.fromCharCode(parseInt(hex, 16));
        at += 6;
      } else if (next !== undefined && Object.hasOwn(ESCAPES, next)) { out += ESCAPES[next]; at += 2; }
      else fail('Invalid escape');
    }
    if (!isWellFormed(out)) fail('Lone surrogate in string');
    return out;
  };
  const value = (depth: number): JsonValue => {
    space();
    const char = text[at];
    if (char === '{' || char === '[') {
      if (depth + 1 > maxDepth) throw new ScanError('depth', `Nesting deeper than ${maxDepth} at offset ${at}`);
      at++; space();
      if (char === '[') {
        const items: JsonValue[] = [];
        if (text[at] === ']') { at++; return items; }
        for (;;) {
          items.push(value(depth + 1)); space();
          if (text[at] === ',') { at++; continue; }
          if (text[at] === ']') { at++; return items; }
          fail('Expected , or ]');
        }
      }
      const object: Record<string, JsonValue> = {};
      const seen = new Set<string>();
      if (text[at] === '}') { at++; return object; }
      for (;;) {
        space();
        if (text[at] !== '"') fail('Expected a key');
        const key = string();
        if (seen.has(key)) throw new ScanError('duplicate-key', `Duplicate key ${JSON.stringify(key)} at offset ${at}`);
        seen.add(key);
        space();
        if (text[at] !== ':') fail('Expected :');
        at++;
        // defineProperty keeps a `__proto__` key an own data property; the schema refuses it afterwards.
        Object.defineProperty(object, key, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
        space();
        if (text[at] === ',') { at++; continue; }
        if (text[at] === '}') { at++; return object; }
        fail('Expected , or }');
      }
    }
    if (char === '"') return string();
    for (const [word, literal] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(word, at)) { at += word.length; return literal; }
    }
    NUMBER.lastIndex = at;
    const match = NUMBER.exec(text);
    if (!match) return fail('Unexpected token');
    const number = Number(match[0]);
    if (!Number.isFinite(number)) fail('Number out of range');
    at += match[0].length;
    return number;
  };
  try {
    const result = value(0);
    space();
    if (at !== text.length) fail('Trailing content');
    return { ok: true, value: result };
  } catch (error) {
    if (error instanceof ScanError) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}

export function isWellFormed(text: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
}

/** An object whose key order is fixed by the writer's caller, not by JavaScript property order. */
export class Ordered {
  constructor(readonly entries: readonly (readonly [string, Written])[]) {}
}
export type Written = null | boolean | number | string | readonly Written[] | Ordered;

/** Unknown data: object keys sorted by UTF-16 code units at every level. */
export function sorted(value: JsonValue): Written {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') return fields(value as JsonObject, [], []);
  return value as Written;
}

/** `first` keys in that order, then the remaining keys sorted, then `last`; nested unknown values are sorted. */
export function fields(object: JsonObject, first: readonly string[], last: readonly string[], known: Readonly<Record<string, (value: JsonValue) => Written>> = {}): Ordered {
  const pick = (key: string): readonly [string, Written] => [key, (known[key] ?? sorted)(object[key]!)];
  const rest = Object.keys(object).filter(key => !first.includes(key) && !last.includes(key)).sort();
  return new Ordered([...first, ...rest, ...last].filter(key => Object.hasOwn(object, key)).map(pick));
}

/** Two-space JSON with LF line breaks, the layout of `JSON.stringify(value, null, 2)` with explicit key order. */
export function writeJson(value: Written, indent = ''): string {
  if (value instanceof Ordered) {
    if (!value.entries.length) return '{}';
    const inner = indent + '  ';
    return `{\n${value.entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${writeJson(item, inner)}`).join(',\n')}\n${indent}}`;
  }
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const inner = indent + '  ';
    return `[\n${value.map(item => inner + writeJson(item, inner)).join(',\n')}\n${indent}]`;
  }
  return JSON.stringify(value);
}

/** Compact canonical form, used to measure serialized sizes independently of indentation. */
export function compactJson(value: Written): string {
  if (value instanceof Ordered) return `{${value.entries.map(([key, item]) => `${JSON.stringify(key)}:${compactJson(item)}`).join(',')}}`;
  if (Array.isArray(value)) return `[${value.map(compactJson).join(',')}]`;
  return JSON.stringify(value);
}
