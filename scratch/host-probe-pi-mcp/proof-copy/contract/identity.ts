// What every app's models share and the host supplies: who is asking (the host's sign-in fills CurrentUser through Session), and the
// one rule "a unit's key is its owner's user id". An app's models import these; they never read a header or a cookie themselves.
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import * as Schema from "effect/Schema";

export class CurrentUser extends Domain.RequestContext<CurrentUser>()("App/CurrentUser", Schema.Struct({ userId: Schema.String, role: Schema.Literals(["owner", "reader"]) })) {}
export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}) {}
export class Session extends RpcMiddleware.Service<Session, { provides: CurrentUser }>()("App/Session", { error: Unauthorized }) {}
export class NotYours extends Domain.Rejection("NotYours", {}, { httpApiStatus: 404, description: "This is not yours." }) {}

export const mustOwn = (key: string | { readonly id: string }) => Effect.gen(function* () {
  const me = yield* CurrentUser;
  if ((typeof key === "string" ? key : key.id) !== me.userId) return yield* new NotYours();
});
