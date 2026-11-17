import type { JsonValue } from '@earendil-works/chord/json';
import { defineTool } from '@earendil-works/pi-durable';
import { requireApproval } from '../../approval.js';
import { admit } from '../identity.js';
import { isRefusal } from '../op.js';
import type { Op } from '../op.js';
import type { AppDefinition, Scope } from '../index.js';
import { SenderUnknown } from './contract.js';
import type { Acting, AppTools } from './contract.js';
import { checkOps } from './check-ops.js';
import { NEVER, SENDER_UNKNOWN, domainNames, json, opsFor, outputOf, pick, readOnly, wire } from './ops-parts.js';
import type { OpAnswer, OpCall, OpHost } from './ops-parts.js';

export { domainNames, opsFor };

/** Who may act on which unit, read now from the unit's own members: a person with a role, or the refusal. */
const enter = async (def: AppDefinition, op: Op, call: OpCall, host: OpHost) => {
  const unit = call.scope?.unit ?? call.unit ?? call.person;
  const storage = host.storage(unit);
  return { unit, storage, who: admit(op.role, unit, (await def.ops?.members?.(storage)) ?? [], op.name, call) };
};

/** The one call path of the three doors: admission, then the handler, then its output checked. Input validation is the door's: pi's own for an agent. */
export async function runOp(def: AppDefinition, op: Op, input: unknown, call: OpCall, host: OpHost): Promise<OpAnswer> {
  const { unit, storage: unitStorage, who } = await enter(def, op, call, host);
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
  const sender = async (...a: Parameters<Acting>) => { try { return (await attribution(...a)).requestedBy; } catch (error) { if (error instanceof SenderUnknown) return SENDER_UNKNOWN; throw error; } };
  const tool = defineTool({
    name: op.name, description: op.description,
    parameters: op.input, structuredOutputSchema: op.output,
    ...(op.kind === 'read' ? { replay: 'safe' as const } : {}),
    execute: async (input, call, context) => {
      const person = await sender(call, context);
      if (typeof person !== 'string') return person;
      const id = op.kind === 'write' ? await commandId?.(call, context) : undefined;
      const answer = await runOp(def, op, input, { person, scope, now: call.now(), signal: context.abortSignal, commandId: id }, host);
      if ('refused' in answer) return json(answer.refused, true);
      if ('broken' in answer) return json({ broken: answer.broken }, true);
      return { ...json(answer.value), structuredOutput: answer.value as JsonValue };
    },
  });
  /** A risky write is refused for an unknown sender or a missing role before the person is asked to approve it. */
  const precheck = async (_args: unknown, call: Parameters<Acting>[0], context: Parameters<Acting>[1]) => {
    const person = await sender(call, context);
    if (typeof person !== 'string') return person;
    const { who } = await enter(def, op, { person, scope, now: call.now() }, host);
    return isRefusal(who) ? json(wire(who), true) : undefined;
  };
  return op.risky ? requireApproval(tool, { summarize: (args) => `${op.name} ${JSON.stringify(args)}`, precheck }) : tool;
}

/** The tools of one agent's plain operations, in `expose` order. */
export function plainTools({ def, api, agent, scope, attribution, commandId, storage, caps }: Pick<Parameters<AppTools>[0], 'def' | 'api' | 'agent' | 'scope' | 'attribution' | 'storage' | 'caps'> & { readonly commandId: Parameters<AppTools>[0]['commandId'] | undefined }) {
  checkOps(def);
  const ops = opsFor(def, agent);
  if (ops.length > 0 && !storage) throw new Error(`appTools(${def.name}): agent ${agent} lists plain operations and no storage was passed`);
  if (!api && domainNames(def, agent).length > 0) throw new Error(`appTools(${def.name}): agent ${agent} lists Domain operations and no api was passed`);
  return ops.map((op) => opTool(def, op, scope, attribution, commandId, { storage: storage!, caps }));
}
