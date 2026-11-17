import type { ToolExecutionResult } from '@earendil-works/pi-durable';
import { compile } from '@earendil-works/pi-schema';
import type { CapabilityMethods, CapNeed, Op, Refusal, SqlValue, UnitStorage } from '../op.js';
import type { AppDefinition, Scope } from '../index.js';

export type OpHost = { readonly storage: (unit: string) => UnitStorage; readonly caps?: Partial<CapabilityMethods> | undefined };
export type OpCall = { readonly person: string; readonly unit?: string | undefined; readonly scope?: Scope | undefined; readonly now: number; readonly signal?: AbortSignal | undefined; readonly commandId?: string | undefined };
export type OpAnswer = { readonly value: unknown } | { readonly refused: object } | { readonly broken: string };

export const SENDER_UNKNOWN: ToolExecutionResult = { output: [{ type: 'text', text: 'refused: sender-unknown. Stop and tell the person.' }], isError: true };
export const NEVER = new AbortController().signal;
export const json = (value: unknown, isError = false): ToolExecutionResult => ({ output: [{ type: 'text', text: JSON.stringify(value) }], isError });
export const wire = (r: Refusal) => ({ _tag: r.kind, ...r.detail });

export const plainOp = (def: AppDefinition, name: string) => def.ops?.list.find((op) => op.name === name);
export const opsFor = (def: AppDefinition, audience: string): readonly Op[] => (def.expose[audience] ?? []).flatMap((name) => plainOp(def, name) ?? []);
export const domainNames = (def: AppDefinition, audience: string) => (def.expose[audience] ?? []).filter((name) => !plainOp(def, name));

const checker = new WeakMap<object, ReturnType<typeof compile>>();
export const outputOf = (op: Op) => checker.get(op.output) ?? checker.set(op.output, compile(op.output)).get(op.output)!;
export const pick = (caps: OpHost['caps'], needs: readonly CapNeed[] = []) => Object.fromEntries(needs.map((need) => [need, caps?.[need]]));
/** A read's storage answers one `select` and nothing else: `run` refuses, and so does `all` for an insert, a `with`, or a second statement. */
export const readOnly = (s: UnitStorage, op: string): UnitStorage => ({
  all: <R extends Record<string, SqlValue>>(sql: string, ...params: SqlValue[]) => /^\s*select\b[^;]*;?\s*$/i.test(sql) ? s.all<R>(sql, ...params) : Promise.reject(new Error(`read-only: ${op}`)),
  run: async () => { throw new Error(`read-only: ${op}`); },
});
