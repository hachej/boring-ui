// The Session middleware of the contract (contract/identity.ts) answered with Better Auth: the person signed in (cookie or session token), or,
// at the MCP door only, the person who agreed that another app acts for them (an OAuth access token the door checked against the database now).
import { RuntimeContext } from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CurrentUser, Session, Unauthorized } from "../contract/identity.ts";
import { Auth } from "./auth.ts";

/** Set by the Worker on `/mcp` only (any value a client sent is overwritten); refused on every other path. */
export const DOOR_HEADER = "x-boring-door";

export const SessionLive = Layer.effect(Session, Effect.gen(function* () {
  const auth = yield* Auth;
  return ((effect: Effect.Effect<unknown, unknown, never>, { headers }: { headers: Record<string, string | undefined> }) => Effect.gen(function* () {
    const h = new Headers(Object.entries(headers).filter((e): e is [string, string] => e[1] !== undefined));
    let userId = (yield* auth.getSession(h).pipe(Effect.orDie))?.user.id;
    if (!userId && h.get(DOOR_HEADER) === "mcp" && /^Bearer /i.test(h.get("authorization") ?? "")) {
      userId = ((yield* (auth.api as any).oauth2UserInfo({ headers: h }).pipe(Effect.catch(() => Effect.succeed(null)))) as { sub?: string } | null)?.sub;
    }
    if (!userId) return yield* new Unauthorized();
    // A person owns their own unit: the key of every block is their user id (contract/identity.ts, mustOwn).
    return yield* effect.pipe(Effect.provideService(CurrentUser, { userId, role: "owner" }));
  }).pipe(Effect.provide(RuntimeContext.phantom))) as never;
}));
