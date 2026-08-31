import { randomUUID } from "node:crypto";
import type {
  BrowserExecIntent,
  BrowserExecRequest,
  BrowserExecResult,
  BrowserHostCapability,
  BrowserScope,
  BrowserSessionEnvironment,
  BrowserViewLease,
} from "./controller";

interface TrustedServiceLease {
  invoke(input: {
    operation: "start" | "observe" | "act" | "takeover" | "return-control" | "stop";
    payload?: Uint8Array;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<{ status: "ok" | "rejected" | "unknown-outcome"; payload?: Uint8Array }>;
  createProjection(input: { mode: "observe" | "control"; expiresAt: Date }): Promise<{
    url: string;
    expiresAt: string;
    revoke(): Promise<void>;
  }>;
  close(): Promise<void>;
}
interface ExactSessionEnvironment {
  readonly environmentGenerationId: string;
  readonly signal: AbortSignal;
  acquireTrustedService(input: { leaseId: string; idleTtlMs: number; absoluteTtlMs: number }): Promise<TrustedServiceLease>;
  release(): void;
}

export interface BrowserHostCapabilityFactoryOptions {
  acquireExactSessionEnvironment(scope: BrowserScope): Promise<ExactSessionEnvironment>;
  issueProjection(input: {
    readonly scope: BrowserScope;
    readonly generationId: string;
    readonly upstream: { readonly url: string; readonly expiresAt: string; revoke(): Promise<void> };
  }): { readonly bootstrapPath: string; readonly expiresAt: string; revoke(): Promise<void> };
  readonly idleTtlMs: number;
  readonly absoluteTtlMs: number;
}

const operations: Record<Exclude<BrowserExecIntent, "status">, "start" | "observe" | "act" | "takeover" | "return-control" | "stop"> = {
  ensure: "start",
  observe: "observe",
  act: "act",
  takeover: "takeover",
  return: "return-control",
  stop: "stop",
};

/** Builds the browser-domain facade over trusted generic Host contracts. */
export function createBrowserHostCapability(options: BrowserHostCapabilityFactoryOptions): BrowserHostCapability {
  return Object.freeze({
    async acquire(scope: BrowserScope): Promise<BrowserSessionEnvironment> {
      const environment = await options.acquireExactSessionEnvironment(scope);
      let released = false;
      try {
        const service = await environment.acquireTrustedService({
          leaseId: randomUUID(),
          idleTtlMs: options.idleTtlMs,
          absoluteTtlMs: options.absoluteTtlMs,
        });
        return Object.freeze({
          generationId: environment.environmentGenerationId,
          signal: environment.signal,
          async invoke(request: BrowserExecRequest): Promise<BrowserExecResult> {
            if (released || environment.signal.aborted) return { ok: false, error: "environment generation retired" };
            if (request.intent === "status") return { ok: false, error: "unsupported operation" };
            let payload: Uint8Array | undefined;
            if (request.payload !== undefined) payload = new TextEncoder().encode(request.payload);
            const result = await service.invoke({
              operation: operations[request.intent],
              ...(payload ? { payload } : {}),
              timeoutMs: request.intent === "act" ? 30_000 : 15_000,
              signal: request.signal ?? environment.signal,
            });
            return {
              ok: result.status === "ok",
              ...(result.payload ? { stdout: new TextDecoder().decode(result.payload) } : {}),
              ...(result.status === "unknown-outcome" ? { error: "unknown outcome" } : {}),
            };
          },
          async createView({ mode }: { readonly mode: "observe" | "control"; readonly controlEpoch: number }): Promise<BrowserViewLease> {
            if (released || environment.signal.aborted) throw new Error("environment generation retired");
            const upstream = await service.createProjection({
              mode,
              expiresAt: new Date(Date.now() + Math.min(options.idleTtlMs, 15 * 60_000)),
            });
            const grant = options.issueProjection({
              scope,
              generationId: environment.environmentGenerationId,
              upstream,
            });
            return Object.freeze({ url: grant.bootstrapPath, expiresAt: grant.expiresAt, revoke: () => grant.revoke() });
          },
          async release() {
            if (released) return;
            released = true;
            await service.close();
            environment.release();
          },
        });
      } catch (error) {
        environment.release();
        throw error;
      }
    },
  });
}
