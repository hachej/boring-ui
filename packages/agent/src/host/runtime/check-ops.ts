import type { Toolable } from '@alchemy.run/domain/Ai';
import type { AppDefinition } from '../index.js';

const NAME = /^[a-zA-Z0-9_-]{1,64}$/;
type Json = { readonly [key: string]: any };

/** The path of the first object schema, at any depth, that accepts a field it does not declare; undefined when every object is closed. */
const openAt = (schema: unknown, path = ''): string | undefined => {
  if (!schema || typeof schema !== 'object') return undefined;
  const s = schema as Json;
  if ((s.type === 'object' || s.properties) && s.additionalProperties !== false) return path || '/';
  if (s.patternProperties) return `${path}/patternProperties`;
  const children: [string, unknown][] = [
    ...Object.entries<unknown>(s.properties ?? {}).map(([k, v]): [string, unknown] => [`${path}/${k}`, v]),
    ...['items', 'not', 'if', 'then', 'else', 'contains'].map((k): [string, unknown] => [`${path}/${k}`, s[k]]),
    ...['prefixItems', 'anyOf', 'oneOf', 'allOf'].flatMap((k) => (Array.isArray(s[k]) ? s[k] : []).map((v: unknown, i: number): [string, unknown] => [`${path}/${k}/${i}`, v])),
    ...['$defs', 'definitions'].flatMap((k) => Object.entries<unknown>(s[k] ?? {}).map(([n, v]): [string, unknown] => [`${path}/${k}/${n}`, v])),
  ];
  for (const [at, child] of children) { const found = openAt(child, at); if (found) return found; }
  return undefined;
};

/** The plain half of `checkExpose`: what a plain operation or an audience gets wrong is refused before anything is served. */
export const checkOps = (def: AppDefinition): void => {
  const fail = (why: string): never => { throw new Error(`checkExpose(${def.name}): ${why}`); };
  const names = new Set<string>(), requests = (def.api as Toolable | undefined)?.group.requests;
  for (const op of def.ops?.list ?? []) {
    const at = `operation ${op.name}`;
    if (!NAME.test(op.name) || op.name.startsWith('delegate')) fail(`${at}: a name of letters, digits, _ and - (64 at most), not starting with delegate`);
    if (names.has(op.name) || requests?.has(op.name)) fail(`${at}: the name is already an operation's`);
    names.add(op.name);
    if (op.risky && op.kind === 'read') fail(`${at}: risky on a read`);
    if (op.risky && def.expose.mcp?.includes(op.name)) fail(`${at}: risky in expose.mcp, which has no approval yet`);
    for (const side of ['input', 'output'] as const) if (!op[side] || typeof op[side] !== 'object' || op[side].type !== 'object') fail(`${at}: the ${side} must be an object schema (obj(...))`);
    const open = openAt(op.input);
    if (open) fail(`${at}: the input is open at ${open}; use obj(...) without open, so a field the operation does not declare is refused`);
    if ('commandId' in (op.input.properties ?? {})) fail(`${at}: the input declares commandId, which only the host sets`);
  }
  if (!def.api) for (const [audience, list] of Object.entries(def.expose)) for (const name of list ?? []) if (!names.has(name)) fail(`expose.${audience} lists ${name}, which is not a plain operation, and the app has no api`);
};
