import * as Domain from '@alchemy.run/domain';
import * as Effect from 'effect/Effect';
import * as RpcMiddleware from 'effect/rpc/RpcMiddleware';
import * as Schema from 'effect/Schema';

/** A role in one unit, ranked owner > editor > reader. Who holds which lives in the unit's own data (`units.members`). */
export const Role = Schema.Literals(['owner', 'editor', 'reader']);
export type Role = typeof Role.Type;
const RANK: Record<Role, number> = { reader: 1, editor: 2, owner: 3 };

/** What an agent session may reach, fixed when it was created: one unit, up to a role, optionally only some operations. Assignable to Chord's `Principal`. */
export const Scope = Schema.Struct({
  kind: Schema.Literals(['unit', 'reader']),
  unit: Schema.String,
  role: Role,
  ops: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.String))),
});
export type Scope = typeof Scope.Type;

/** `userId` is who is recorded as the author. With a `scope` the caller is an agent session: its rights are the scope, whoever sent the message. */
export class CurrentUser extends Domain.RequestContext<CurrentUser>()(
  'App/CurrentUser',
  Schema.Struct({ userId: Schema.String, scope: Schema.optionalKey(Scope) }),
) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}

/** Provides `CurrentUser`; the host's sign-in fills it. A model never reads a header or a cookie. */
export class Session extends RpcMiddleware.Service<Session, { provides: CurrentUser }>()('App/Session', { error: Unauthorized }) {}

export class NotYours extends Domain.Rejection('NotYours', {}, { httpApiStatus: 404, description: 'This is not yours.' }) {}
export class NotAllowed extends Domain.Rejection('NotAllowed', { need: Schema.String }, { httpApiStatus: 403, description: 'Your role does not allow it.' }) {}

/** The rule "a unit's key is its owner's user id". */
export const mustOwn = (key: string | { readonly id: string }) => Effect.gen(function* () {
  const me = yield* CurrentUser;
  if ((typeof key === 'string' ? key : key.id) !== me.userId) return yield* new NotYours();
});

export type Member = { readonly userId: string; readonly role: Role };

/** The one rule for every command and view: a scoped caller has exactly its scope; a person has the role the unit's data gives them, read now. */
export const must = (need: Role, unit: string, members: ReadonlyArray<Member>, op: string) => Effect.gen(function* () {
  const me = yield* CurrentUser;
  if (me.scope) {
    if (me.scope.unit !== unit || (me.scope.ops && !me.scope.ops.includes(op))) return yield* new NotYours();
    if (RANK[me.scope.role] < RANK[need]) return yield* new NotAllowed({ need });
    return;
  }
  const mine = members.find((m) => m.userId === me.userId)?.role;
  if (!mine) return yield* new NotYours();
  if (RANK[mine] < RANK[need]) return yield* new NotAllowed({ need });
});
