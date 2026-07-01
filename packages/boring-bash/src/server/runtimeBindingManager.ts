import type {
  BoundFilesystemContext,
  FilesystemAccess,
  FilesystemBinding,
  FilesystemBindingProvider,
  FilesystemBindingResolver,
  FilesystemId,
  FilesystemProjection,
  PreparedFilesystemBinding,
  RuntimeBindingPlan,
} from "../shared/index";

export interface FilesystemRuntimeLifecycleEvent {
  readonly type: "prepare" | "prepare-error" | "dispose" | "invalidate";
  readonly context: BoundFilesystemContext;
  readonly bindings: readonly string[];
  readonly preparedLabels: readonly string[];
}

export interface ScopedFilesystemRuntimeBindingManagerOptions {
  readonly resolver: FilesystemBindingResolver;
  readonly providers: Readonly<Record<string, FilesystemBindingProvider>>;
  readonly onLifecycleEvent?: (event: FilesystemRuntimeLifecycleEvent) => void;
}

export interface PreparedBindingSelector {
  readonly filesystem: FilesystemId;
  readonly access?: FilesystemAccess;
  readonly projection?: FilesystemProjection;
}

export interface ScopedPreparedFilesystemBinding extends PreparedFilesystemBinding {
  readonly scopeKey: string;
  readonly context: BoundFilesystemContext;
  readonly preparedLabel: string;
}

export interface ScopedRuntimeBindingPlan extends RuntimeBindingPlan {
  readonly scopeKey: string;
  readonly context: BoundFilesystemContext;
  readonly bindings: ScopedPreparedFilesystemBinding[];
}

export function filesystemRuntimeScopeKey(ctx: BoundFilesystemContext): string {
  return [
    ctx.humanUserId,
    ctx.agentId,
    ctx.sessionId,
    ctx.workspaceId,
    ctx.requestId,
  ].join("\0");
}

function sameBinding(binding: FilesystemBinding, selector: PreparedBindingSelector): boolean {
  return binding.filesystem === selector.filesystem
    && (selector.access === undefined || binding.access === selector.access)
    && (selector.projection === undefined || binding.projection === selector.projection);
}

export class ScopedFilesystemRuntimeBindingManager {
  readonly #resolver: FilesystemBindingResolver;
  readonly #providers: Readonly<Record<string, FilesystemBindingProvider>>;
  readonly #onLifecycleEvent: ScopedFilesystemRuntimeBindingManagerOptions["onLifecycleEvent"];
  readonly #plans = new Map<string, ScopedRuntimeBindingPlan>();
  #nextPreparedLabel = 1;

  constructor(options: ScopedFilesystemRuntimeBindingManagerOptions) {
    this.#resolver = options.resolver;
    this.#providers = options.providers;
    this.#onLifecycleEvent = options.onLifecycleEvent;
  }

  async prepareRuntime(ctx: BoundFilesystemContext): Promise<ScopedRuntimeBindingPlan> {
    const scopeKey = filesystemRuntimeScopeKey(ctx);
    await this.disposeRuntime(ctx);

    const bindings = await this.#resolver.resolveBindings(ctx);
    const prepared: ScopedPreparedFilesystemBinding[] = [];
    try {
      for (const binding of bindings) {
        const provider = this.#providers[String(binding.filesystem)];
        if (!provider) throw new Error(`no filesystem binding provider for ${binding.filesystem}`);
        const preparedBinding = await provider.prepareBinding(ctx, binding);
        prepared.push({
          ...preparedBinding,
          scopeKey,
          context: { ...ctx },
          preparedLabel: `prepared-${this.#nextPreparedLabel++}`,
        });
      }
    } catch (error) {
      this.#emit("prepare-error", ctx, bindings, prepared);
      await Promise.allSettled(prepared.map((binding) => this.#disposePrepared(binding)));
      throw error;
    }

    const plan: ScopedRuntimeBindingPlan = { scopeKey, context: { ...ctx }, bindings: prepared };
    this.#plans.set(scopeKey, plan);
    this.#emit("prepare", ctx, bindings, prepared);
    return plan;
  }

  getPreparedBinding(ctx: BoundFilesystemContext, selector: PreparedBindingSelector): ScopedPreparedFilesystemBinding | undefined {
    const plan = this.#plans.get(filesystemRuntimeScopeKey(ctx));
    return plan?.bindings.find((binding) => sameBinding(binding.binding, selector));
  }

  async disposeRuntime(ctx: BoundFilesystemContext): Promise<void> {
    const scopeKey = filesystemRuntimeScopeKey(ctx);
    const plan = this.#plans.get(scopeKey);
    if (!plan) return;
    this.#plans.delete(scopeKey);
    await Promise.all(plan.bindings.map((binding) => this.#disposePrepared(binding)));
    this.#emit("dispose", ctx, plan.bindings.map((binding) => binding.binding), plan.bindings);
  }

  async invalidate(ctx: BoundFilesystemContext, filesystem: FilesystemId): Promise<void> {
    const scopeKey = filesystemRuntimeScopeKey(ctx);
    const plan = this.#plans.get(scopeKey);
    if (!plan) return;

    const remaining: ScopedPreparedFilesystemBinding[] = [];
    for (const binding of plan.bindings) {
      if (binding.binding.filesystem === filesystem) {
        await this.#disposePrepared(binding);
      } else {
        remaining.push(binding);
      }
    }

    const provider = this.#providers[String(filesystem)];
    await provider?.invalidateBinding?.(ctx, filesystem);

    const invalidated = plan.bindings.filter((binding) => binding.binding.filesystem === filesystem);
    if (remaining.length === 0) {
      this.#plans.delete(scopeKey);
    } else {
      this.#plans.set(scopeKey, { ...plan, bindings: remaining });
    }
    this.#emit("invalidate", ctx, invalidated.map((binding) => binding.binding), invalidated);
  }

  #emit(
    type: FilesystemRuntimeLifecycleEvent["type"],
    ctx: BoundFilesystemContext,
    bindings: readonly FilesystemBinding[],
    prepared: readonly ScopedPreparedFilesystemBinding[],
  ): void {
    this.#onLifecycleEvent?.({
      type,
      context: { ...ctx },
      bindings: bindings.map((binding) => `${binding.filesystem}:${binding.access}:${binding.projection}`),
      preparedLabels: prepared.map((binding) => binding.preparedLabel),
    });
  }

  async #disposePrepared(binding: ScopedPreparedFilesystemBinding): Promise<void> {
    const provider = this.#providers[String(binding.binding.filesystem)];
    await provider?.disposeBinding?.(binding);
  }
}
