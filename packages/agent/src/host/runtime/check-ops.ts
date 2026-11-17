import type { Toolable } from '@alchemy.run/domain/Ai';
import type { AppDefinition } from '../index.js';

const NAME = /^[a-zA-Z0-9_-]{1,64}$/;

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
    if (op.input.type !== 'object' || op.output.type !== 'object') fail(`${at}: input and output are objects`);
    if (op.input.additionalProperties !== false) fail(`${at}: the input is open; use obj(...) without open, so a field the operation does not declare is refused`);
    if ('commandId' in (op.input.properties ?? {})) fail(`${at}: the input declares commandId, which only the host sets`);
  }
  if (!def.api) for (const [audience, list] of Object.entries(def.expose)) for (const name of list ?? []) if (!names.has(name)) fail(`expose.${audience} lists ${name}, which is not a plain operation, and the app has no api`);
};
