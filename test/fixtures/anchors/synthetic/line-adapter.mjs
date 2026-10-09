// Synthetic `test.line@1` adapter: a TEST fixture for the anchor conformance kit, never package source.
// Snapshot: { lines: string[] }. Range: { line } (0-based). The anchor keeps the line text and its two
// neighbours. A text match whose neighbours both agree is the identity; only a unique identity is placed.

const KIND = 'test.line@1';
const neighbour = value => value === null || typeof value === 'string';

export const lineSchema = {
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'text', 'before', 'after', 'line', 'fallback'],
    properties: {
      kind: { const: KIND },
      text: { type: 'string' },
      before: { type: ['string', 'null'] },
      after: { type: ['string', 'null'] },
      line: { type: 'integer', minimum: 0 },
      fallback: { type: 'string', minLength: 1 },
    },
  },
  parse(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('test.line@1 anchor must be an object');
    const { kind, text, before, after, line, fallback } = value;
    if (kind !== KIND) throw new TypeError(`expected ${KIND}`);
    if (typeof text !== 'string' || !neighbour(before) || !neighbour(after)) throw new TypeError('test.line@1 text and neighbours must be strings or null');
    if (!Number.isInteger(line) || line < 0) throw new TypeError('test.line@1 line must be a non-negative integer');
    if (typeof fallback !== 'string' || fallback.trim() === '') throw new TypeError('test.line@1 fallback must be non-empty');
    return { kind, text, before, after, line, fallback };
  },
};

/** Capture: the anchor for line `index` of `snapshot`. */
export function captureLine(snapshot, index) {
  const text = snapshot.lines[index];
  if (text === undefined) throw new RangeError(`no line ${index}`);
  return { kind: KIND, text, before: snapshot.lines[index - 1] ?? null, after: snapshot.lines[index + 1] ?? null, line: index, fallback: `Line ${index + 1}: "${text}"` };
}

export function resolveLine(anchor, snapshot, evaluated) {
  const candidates = [];
  const identities = [];
  snapshot.lines.forEach((text, line) => {
    if (text !== anchor.text) return;
    candidates.push({ line });
    if ((snapshot.lines[line - 1] ?? null) === anchor.before && (snapshot.lines[line + 1] ?? null) === anchor.after) identities.push(line);
  });
  if (identities.length === 1) {
    const [line] = identities;
    return { kind: line === anchor.line ? 'exact' : 'moved', range: { line }, evaluated };
  }
  if (candidates.length) return { kind: 'ambiguous', candidates, evaluated };
  return { kind: 'missing', evaluated };
}

export const lineResolution = {
  kind: KIND,
  schema: lineSchema,
  resolve: resolveLine,
  fallback: anchor => anchor.fallback,
};
