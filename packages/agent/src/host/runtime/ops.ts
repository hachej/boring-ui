import type { JsonValue } from '@earendil-works/chord/json';
import { defineTool } from '@earendil-works/pi-durable';
import type { ToolExecutionResult } from '@earendil-works/pi-durable';
import { compile } from '@earendil-works/pi-schema';
import { requireApproval } from '../../approval.js';
import { admit } from '../identity.js';
import { isRefusal } from '../op.js';
import type { CapabilityMethods, CapNeed, Op, Refusal, SqlValue, UnitStorage } from '../op.js';
import type { AppDefinition, Scope } from '../index.js';
import { SenderUnknown } from './contract.js';
import type { Acting, AppTools } from './contract.js';

export type OpHost = { readonly storage: (unit: string) => UnitStorage; readonly caps?: Partial<CapabilityMethods> | undefined };
export type OpCall = { readonly person: string; readonly unit?: string | undefined; readonly scope?: Scope | undefined; readonly now: number; readonly signal?: AbortSignal | undefined; readonly commandId?: string | undefined };
export type OpAnswer = { readonly value: unknown } | { readonly refused: object } | { readonly broken: string };

const SENDER_UNKNOWN: ToolExecutionResult = { output: [{ type: 'text', text: 'refused: sender-unknown. Stop and tell the person.' }], isError: true };
const NEVER = new AbortController().signal;
const json = (value: unknown, isError = false): ToolExecutionResult => ({ output: [{ type: 'text', text: JSON.stringify(value) }], isError });
const wire = (r: Refusal) => ({ _tag: r.kind, ...r.detail });

export const plainOp = (def: AppDefinition, name: string) => def.ops?.list.find((op) => op.name === name);
export const opsFor = (def: AppDefinition, audience: string): readonly Op[] => (def.expose[audience] ?? []).flatMap((name) => plainOp(def, name) ?? []);
export const domainNames = (def: AppDefinition, audience: string) => (def.expose[audience] ?? []).filter((name) => !plainOp(def, name));

const checker = new WeakMap<object, ReturnType<typeof compile>>();
const outputOf = (op: Op) => checker.get(op.output) ?? checker.set(op.output, compile(op.output)).get(op.output)!;
const pick = (caps: OpHost['caps'], needs: readonly CapNeed[] = []) => Object.fromEntries(needs.map((need) => [need, caps?.[need]]));
/** A read's storage answers one `select` and nothing else: `run` refuses, and so does `all` for an insert, a `with`, or a second statement. */
const readOnly = (s: UnitStorage, op: string): UnitStorage => ({
  all: <R extends Record<string, SqlValue>>(sql: string, ...params: SqlValue[]) => /^\s*select\b[^;]*;?\s*$/i.test(sql) ? s.all<R>(sql, ...params) : Promise.reject(new Error(`read-only: ${op}`)),
  run: async () => { throw new Error(`read-only: ${op}`); },
});

/** The one call path of the three doors: admission, then the handler, then its output checked. Input validation is the door's: pi's own for an agent. */
export async function runOp(def: AppDefinition, op: Op, input: unknown, call: OpCall, host: OpHost): Promise<OpAnswer> {
  const unit = call.scope?.unit ?? call.unit ?? call.person;
  const unitStorage = host.storage(unit);
  const who = admit(op.role, unit, (await def.ops?.members?.(unitStorage)) ?? [], op.name, call);
  if (isRefusal(who)) return { refused: wire(who) };
  const storage = op.kind === 'read' ? readOnly(unitStorage, op.name) : unitStorage;
  const ctx = Object.freeze({ who, unit, now: new Date(call.now).toISOString(), signal: call.signal ?? NEVER, storage, caps: pick(host.caps, op.needs), commandId: call.commandId });
  const out = await op.run(input as never, ctx as never);
  if (isRefusal(out)) return { refused: wire(out) };
  const checked = outputOf(op).validate(out);
  return checked.ok ? { value: out } : { broken: checked.errors.map((e) => `${e.path}: ${e.message}`).join('; ') };
}

/** One plain operation as one pi-durable tool. Who, the unit, the time and the command id are read inside each call. */
export function opTool(def: AppDefinition, op: Op, scope: Scope | undefined, attribution: Acting, commandId: ((...a: Parameters<Acting>) => Promise<string>) | undefined, host: OpHost) {
  const tool = defineTool({
    name: op.name, description: op.description,
    parameters: op.input, structuredOutputSchema: op.output,
    ...(op.kind === 'read' ? { replay: 'safe' as const } : {}),
    execute: async (input, call, context) => {
      let person: string;
      try { ({ requestedBy: person } = await attribution(call, context)); }
      catch (error) { if (error instanceof SenderUnknown) return SENDER_UNKNOWN; throw error; }
      const id = op.kind === 'write' ? await commandId?.(call, context) : undefined;
      const answer = await runOp(def, op, input, { person, scope, now: call.now(), signal: context.abortSignal, commandId: id }, host);
      if ('refused' in answer) return json(answer.refused, true);
      if ('broken' in answer) return json({ broken: answer.broken }, true);
      return { ...json(answer.value), structuredOutput: answer.value as JsonValue };
    },
  });
  return op.risky ? requireApproval(tool, { summarize: (args) => `${op.name} ${JSON.stringify(args)}` }) : tool;
}

/** The tools of one agent's plain operations, in `expose` order. */
export function plainTools({ def, agent, scope, attribution, commandId, storage, caps }: Pick<Parameters<AppTools>[0], 'def' | 'agent' | 'scope' | 'attribution' | 'storage' | 'caps'> & { readonly commandId: Parameters<AppTools>[0]['commandId'] | undefined }) {
  const ops = opsFor(def, agent);
  if (ops.length > 0 && !storage) throw new Error(`appTools(${def.name}): agent ${agent} lists plain operations and no storage was passed`);
  return ops.map((op) => opTool(def, op, scope, attribution, commandId, { storage: storage!, caps }));
}
