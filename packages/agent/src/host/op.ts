import type { Schema, Static } from '@earendil-works/pi-schema';

/** Structurally `identity.ts`'s `Role` and `Member`, restated here so the two files do not import each other. */
type Role = 'owner' | 'editor' | 'reader';
type Member = { readonly userId: string; readonly role: Role };

export type SqlValue = string | number | null;
/** One unit's own SQLite, and only that unit's. The host builds it; an operation never names another unit's. */
export type UnitStorage = {
  readonly all: <R extends Record<string, SqlValue>>(sql: string, ...params: SqlValue[]) => Promise<R[]>;
  readonly run: (sql: string, ...params: SqlValue[]) => Promise<void>;
};
/** Who is asking: the call's sender, with the role the session's scope or the unit's members give. Never from the input. */
export type Who = { readonly person: string; readonly role: Role };
/** The capabilities an operation may declare, by need; empty until `cap-wiring` adds its entries by declaration merging. Their methods return Promises. */
export interface CapabilityMethods {}
export type CapNeed = keyof CapabilityMethods;
export type OpContext<C extends CapNeed = never> = {
  readonly who: Who;
  readonly unit: string;
  readonly now: string;
  readonly signal: AbortSignal;
  /** The unit's own; for a read, one that answers a single `select` and refuses anything else. */
  readonly storage: UnitStorage;
  readonly caps: { readonly [K in C]: CapabilityMethods[K] };
  /** A write's host id; the model never sees or sets it. */
  readonly commandId?: string | undefined;
};
const REFUSAL = Symbol.for('boring.refusal');
/** A refusal is a value with a kind: the kind is a key of the app's `words.refusals`, as a Domain rejection tag is. */
export type Refusal = { readonly [REFUSAL]: true; readonly kind: string; readonly detail: Readonly<Record<string, SqlValue | boolean>> };
export type Op<N extends string = string, I extends Schema = any, O extends Schema = any, C extends CapNeed = CapNeed> = {
  readonly name: N;
  readonly description: string;
  /** pi-schema `obj(...)` without `open`: a closed object, passed to pi as is; the mount refuses any other. */
  readonly input: I;
  readonly output: O;
  /** The least role in the unit. */
  readonly role: Role;
  readonly kind: 'read' | 'write';
  /** A write only: the person approves before it runs (agent door; refused on MCP for now). */
  readonly risky?: true;
  readonly needs?: readonly C[];
  readonly run: (input: Static<I>, ctx: OpContext<C>) => Promise<Static<O> | Refusal>;
};
/** The plain form of an app. `members` absent: a personal app, each person's unit is their own id. */
export type PlainOps = {
  readonly list: readonly Op[];
  readonly members?: (storage: UnitStorage) => Promise<readonly Member[]>;
  /** The unit's tables, run by the storage once per unit before its first call. */
  readonly schema?: readonly string[];
};
export const defineOp = <const N extends string, const I extends Schema, const O extends Schema, const C extends CapNeed = never>(op: Op<N, I, O, C>): Op<N, I, O, C> => op;
export const refuse = (kind: string, detail: Refusal['detail'] = {}): Refusal => Object.freeze({ [REFUSAL]: true as const, kind, detail });
export const isRefusal = (value: unknown): value is Refusal => typeof value === 'object' && value !== null && REFUSAL in value;
/** A view's typed `call` over the app's plain operations; at run time it is `ViewProps.call`. */
export type CallOps<L extends readonly Op[]> = <N extends L[number]['name']>(name: N, input: Static<Extract<L[number], { name: N }>['input']>) => Promise<Static<Extract<L[number], { name: N }>['output']>>;
