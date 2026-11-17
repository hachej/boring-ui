// @ts-nocheck: copied unchanged from boring-factory templates/runtime/src/llm-structured.mjs at 4b5437ab5
// env.llm and ctx.llm with structured answers (services/llm/README.md "Structured answers"), one definition for the host's routes
// (contract.mjs), every operation (operations.mjs) and the single-app runtime's routes (runtime.ts). Both functions are
// self-contained, like decideOf: contract.mjs puts their source in the app's shim, so nothing here reaches outside them.

/** The JSON-schema subset structured() takes: `problem(schema)` names what it cannot use, `check(schema, value)` what a value breaks. */
export function schemaCheck() {
  const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
  const KEYS = ['type', 'properties', 'required', 'items', 'enum', 'additionalProperties', 'description', 'title'];
  const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const typesOf = (s) => (s.type === undefined ? [] : [].concat(s.type));
  const problem = (s, at = '$') => {
    if (!plain(s)) return `${at}: a schema is an object`;
    const unknown = Object.keys(s).find((k) => !KEYS.includes(k));
    if (unknown !== undefined) return `${at}: unsupported keyword ${unknown.slice(0, 40).replace(/[^\w$.-]/g, '?')}`;
    if (s.type === undefined && s.enum === undefined) return `${at}: a type or an enum`;
    if ((Array.isArray(s.type) && !s.type.length) || typesOf(s).some((t) => !TYPES.includes(t))) return `${at}.type: ${TYPES.join(', ')}`;
    const scalars = (list) => Array.isArray(list) && list.length > 0 && list.every((v) => v === null || typeof v !== 'object');
    if (s.enum !== undefined && !scalars(s.enum)) return `${at}.enum: a list of strings, numbers, booleans or null`;
    if (s.properties !== undefined && !plain(s.properties)) return `${at}.properties: an object of schemas`;
    for (const [k, v] of Object.entries(s.properties ?? {})) { const p = problem(v, `${at}.${k}`); if (p) return p; }
    const named = (k) => typeof k === 'string' && Object.hasOwn(s.properties ?? {}, k);
    if (s.required !== undefined && (!Array.isArray(s.required) || !s.required.every(named))) return `${at}.required: names of its properties`;
    if (s.additionalProperties !== undefined && typeof s.additionalProperties !== 'boolean') return `${at}.additionalProperties: true or false`;
    return s.items === undefined ? null : problem(s.items, `${at}[]`);
  };
  const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  const is = (t, v) => (t === 'integer' ? Number.isInteger(v) : t === 'number' ? Number.isFinite(v) : kind(v) === t);
  // Paths come from the schema; a key the answer added is never named, so no text of the answer reaches a message.
  const check = (s, v, at = '$') => {
    if (s.type !== undefined && !typesOf(s).some((t) => is(t, v))) return `${at}: expected ${typesOf(s).join(' or ')}`;
    if (s.enum !== undefined && !s.enum.includes(v)) return `${at}: not one of the allowed values`;
    if (kind(v) === 'object') {
      const missing = (s.required ?? []).find((k) => !Object.hasOwn(v, k));
      if (missing !== undefined) return `${at}.${missing}: required`;
      for (const [k, x] of Object.entries(v)) {
        if (Object.hasOwn(s.properties ?? {}, k)) { const p = check(s.properties[k], x, `${at}.${k}`); if (p) return p; }
        else if (s.additionalProperties === false) return `${at}: a property the schema does not allow`;
      }
    }
    if (kind(v) === 'array' && s.items !== undefined) for (const [i, x] of v.entries()) { const p = check(s.items, x, `${at}[${i}]`); if (p) return p; }
    return null;
  };
  return Object.freeze({ problem, check });
}

/**
 * `{ complete, structured }` over `caps.llm` (the port's completion), after `signedIn()`; `fail(status, message, extra)` throws.
 * structured({ messages, schema, purpose, model?, effort?, maxTokens?, timeoutMs? }) -> { value, usage, model, region }: the
 * schema rides on the port's input (`schema`: the fake answers a value of its shape, a real model reads the instruction), the
 * answer is parsed and checked, one corrective turn is asked on a miss. Refusals (extra.code): invalid-schema (400, before any
 * call), invalid (502), refused (422), timeout (504), and the port's own codes as they came.
 */
export function llmOf(caps, signedIn, fail) {
  const SCHEMA_CHARS = 20_000, MAX_MESSAGES = 50, DEFAULT_TIMEOUT = 60_000, MAX_TIMEOUT = 300_000;
  const { problem, check } = schemaCheck();
  const refuse = (status, code, message, retryable = false) => fail(status, message, { code, retryable });
  const call = (input) => {
    signedIn();
    if (typeof caps.llm !== 'function') refuse(501, 'unconfigured', 'this host does not provide llm yet');
    return caps.llm(input);
  };
  const instruction = (schema) => 'Reply with one JSON object and nothing else, no prose and no code fence: {"answer": <value>}, where <value> is valid against this JSON schema: '
    + `${JSON.stringify(schema)}. If you cannot or must not answer, reply {"refusal": "<a short reason>"} instead.`;
  const read = (schema, text) => {
    let said;
    try { said = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1')); } catch { return { problem: 'not JSON' }; }
    if (said && typeof said === 'object' && !Array.isArray(said) && typeof said.refusal === 'string' && !Object.hasOwn(said, 'answer')) return { refused: true };
    if (!said || typeof said !== 'object' || Array.isArray(said) || !Object.hasOwn(said, 'answer')) return { problem: 'not an object with an "answer"' };
    const p = check(schema, said.answer, '$');
    return p ? { problem: p } : { value: said.answer };
  };
  const sum = (a, b) => (a === null || b === null ? null : a + b);
  const freeze = (v) => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
  const ask = async (input) => {
    const { schema, timeoutMs: _timeout, messages, ...rest } = input;
    const first = messages[0]?.role === 'system'
      ? [{ role: 'system', content: `${messages[0].content}\n\n${instruction(schema)}` }, ...messages.slice(1)]
      : [{ role: 'system', content: instruction(schema) }, ...messages];
    const said = await call({ ...rest, schema, messages: first });
    let got = read(schema, said.text), last = said, usage = said.usage;
    if (got.problem && first.length + 2 <= MAX_MESSAGES) {
      const again = [{ role: 'assistant', content: String(said.text).slice(0, 4000).trim() || '(empty)' },
        { role: 'user', content: `That reply is not valid (${got.problem}). Reply again with only the JSON object.` }];
      last = await call({ ...rest, schema, messages: [...first, ...again] });
      got = read(schema, last.text);
      usage = { input: sum(usage.input, last.usage.input), output: sum(usage.output, last.usage.output) };
    }
    if (got.refused) refuse(422, 'refused', 'the model refused to answer');
    if (got.problem) refuse(502, 'invalid', 'the model did not answer with JSON valid for the schema', true);
    return Object.freeze({ value: freeze(got.value), usage: Object.freeze({ ...usage }), model: last.model, region: last.region });
  };
  const structured = async (input) => {
    signedIn();
    if (!input || typeof input !== 'object' || Array.isArray(input)) refuse(400, 'error', 'input: an object');
    let size;
    try { size = JSON.stringify(input.schema)?.length; } catch { size = Infinity; }
    const p = size === undefined ? '$: a schema is an object' : size > SCHEMA_CHARS ? `at most ${SCHEMA_CHARS} characters as JSON` : problem(input.schema);
    if (p) refuse(400, 'invalid-schema', `schema: ${p}`);
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT) refuse(400, 'error', `timeoutMs: an integer from 1 to ${MAX_TIMEOUT}`);
    if (!Array.isArray(input.messages) || !input.messages.length || input.messages.some((m) => !m || typeof m !== 'object')) refuse(400, 'error', `messages: from 1 to ${MAX_MESSAGES}`);
    let timer;
    const late = new Promise((_, reject) => {
      timer = setTimeout(() => { try { refuse(504, 'timeout', 'the structured answer took too long; retry later', true); } catch (e) { reject(e); } }, timeoutMs);
    });
    try { return await Promise.race([ask(input), late]); } finally { clearTimeout(timer); }
  };
  return Object.freeze({
    complete: async (input) => {
      if (input && typeof input === 'object' && Object.hasOwn(input, 'schema')) refuse(400, 'error', 'schema: a structured answer is llm.structured');
      return call(input);
    },
    structured,
  });
}

/** The fake's structured answer (services/llm/adapters/fake and the runtime's fake): a value of the schema's shape, from the schema only. */
export function sampleOf(schema) {
  const s = schema && typeof schema === 'object' && !Array.isArray(schema) ? schema : {};
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  const type = [].concat(s.type ?? 'null').find((t) => t !== 'null') ?? 'null';
  if (type === 'object') return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, sampleOf(v)]));
  if (type === 'array') return s.items === undefined ? [] : [sampleOf(s.items)];
  return { string: 'fake', number: 0, integer: 0, boolean: false }[type] ?? null;
}

/** The fake's whole reply to a structured call: the envelope structured() reads. */
export const fakeStructured = (schema) => JSON.stringify({ answer: sampleOf(schema) });
