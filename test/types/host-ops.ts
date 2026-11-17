// host-ops-plain AC-1 and AC-23: an operation's handler is typed from its own schemas, a view's `call` from the list, and `ctx.caps`
// from what the operation declares. Each refusal sits beside a twin that compiles; removing an expect-error line fails this file on it.
import { int, obj, str } from '@earendil-works/pi-schema';
import { defineOp, refuse } from '@hachej/boring-agent/host';
import type { CallOps, CapabilityMethods, CapNeed, Op, OpContext, PlainOps, Refusal, SqlValue, UnitStorage, Who } from '@hachej/boring-agent/host';

export const addNote = defineOp({
  name: 'addNote', description: 'Add a note.', input: obj({ text: str() }), output: obj({ number: int() }), role: 'editor', kind: 'write',
  run: async (input, ctx) => {
    const text: string = input.text;
    return text === '' ? refuse('EmptyNote') : { number: ctx.who.person.length };
  },
});
export const listNotes = defineOp({ name: 'listNotes', description: 'List.', input: obj({}), output: obj({ count: int() }), role: 'reader', kind: 'read', run: async () => ({ count: 0 }) });

export const readsMissingField = defineOp({
  name: 'a', description: 'a', input: obj({ text: str() }), output: obj({ number: int() }), role: 'editor', kind: 'write',
  // @ts-expect-error the input schema has no userId
  run: async (input) => ({ number: input.userId.length }),
});
export const wrongOutput = defineOp({
  name: 'b', description: 'b', input: obj({}), output: obj({ number: int() }), role: 'editor', kind: 'write',
  // @ts-expect-error the output schema says an integer
  run: async () => ({ number: '1' }),
});

const list = [addNote, listNotes] as const;
declare const call: CallOps<typeof list>;
export const typed = async (): Promise<number> => (await call('addNote', { text: 'x' })).number;
// @ts-expect-error no operation of that name
export const misspelled = () => call('addNotes', { text: 'x' });
// @ts-expect-error the input of addNote is { text: string }
export const wrongInput = () => call('addNote', { text: 1 });

export const noNeedNoCaps = defineOp({
  name: 'c', description: 'c', input: obj({}), output: obj({}), role: 'reader', kind: 'read',
  // @ts-expect-error the operation declares no needs, so ctx.caps has no decision
  run: async (_input, ctx) => { ctx.caps.decision; return {}; },
});
export const unknownNeed = defineOp({
  name: 'd', description: 'd', input: obj({}), output: obj({}), role: 'reader', kind: 'read',
  // @ts-expect-error CapabilityMethods holds no decision today
  needs: ['decision'],
  run: async () => ({}),
});

export const names = [null as unknown as CapabilityMethods, null as unknown as CapNeed, null as unknown as Op, null as unknown as OpContext, null as unknown as PlainOps,
  null as unknown as Refusal, null as unknown as SqlValue, null as unknown as UnitStorage, null as unknown as Who];
