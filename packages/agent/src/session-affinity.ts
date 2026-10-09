// @hachej/boring-agent/session-affinity: pins a Pi provider's requests to one affinity key. Workers AI keeps a prompt's prefix cache on
// one replica and routes a request by its `x-session-affinity` header, which pi-ai's provider sets from the `sessionId` stream option.
// Pi's durable harness never passes that option, so each turn can land on another replica and recompute the whole prompt. Dependency-free:
// it only wraps the object it is given.

/** The stream options this wrapper reads. Pi's own option type has more fields; the wrapper passes every one through. */
interface AffinityOptions { readonly sessionId?: string }

type Stream = (model: unknown, context: unknown, options?: AffinityOptions) => unknown;

/**
 * A provider whose `stream` and `streamSimple` send `sessionId: key` unless the call names one itself. Every other property and method
 * is the target's, bound to it. Use one key per scope that shares a prompt prefix (a durable object, a conversation):
 * `models.setProvider(withSessionAffinity(ai.provider, scope))`.
 */
export function withSessionAffinity<T extends object>(provider: T, key: string): T {
  const pinned = (options?: AffinityOptions): AffinityOptions => ({ ...options, sessionId: options?.sessionId ?? key });
  return new Proxy(provider, { get(target, name) {
    if (name === 'stream' || name === 'streamSimple') {
      const call = Reflect.get(target, name, target) as Stream;
      return (model: unknown, context: unknown, options?: AffinityOptions) => call.call(target, model, context, pinned(options));
    }
    const value = Reflect.get(target, name, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
