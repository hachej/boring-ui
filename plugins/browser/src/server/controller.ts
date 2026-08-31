import { createHash, randomUUID } from "node:crypto";
import {
  ABSOLUTE_TTL_MS,
  BROWSER_NOVNC_TARGET,
  IDLE_TTL_MS,
  canonicalPlan,
  parseActionPlan,
  type BrowserAction,
  type BrowserActionPlan,
  type BrowserObservation,
  type BrowserSessionView,
} from "../shared";

export type BrowserScope = Readonly<{
  workspaceId: string;
  userId: string;
  agentId: string;
  agentSessionId: string;
}>;
export type BrowserExecIntent =
  "ensure" | "status" | "observe" | "act" | "takeover" | "return" | "stop";
export type BrowserExecRequest = Readonly<{
  intent: BrowserExecIntent;
  sessionId: string;
  controlEpoch: number;
  payload?: string;
  signal?: AbortSignal;
}>;
export type BrowserExecResult = Readonly<{
  ok: boolean;
  stdout?: string;
  error?: string;
}>;
export type BrowserExec = (
  request: BrowserExecRequest,
) => Promise<BrowserExecResult>;
export type BrowserExecutionIdentity = Readonly<{ toolCallId: string; requestId?: string }>;
export type BrowserPlanAdmission = (
  request: Readonly<{ scope: BrowserScope; identity: BrowserExecutionIdentity; planHash: string; plan: BrowserActionPlan }>,
) => Promise<Readonly<{ admitted: boolean; approvalRef?: string }>>;
export type BrowserAdmission = (
  request: Readonly<{
    scope: BrowserScope;
    identity: BrowserExecutionIdentity;
    planHash: string;
    action: BrowserAction;
    actionIndex: number;
  }>,
) => Promise<Readonly<{ admitted: boolean; approvalRef?: string }>>;
export type BrowserAudit = (
  event: Readonly<Record<string, unknown>>,
) => void | Promise<void>;
export type BrowserEnvironmentHandle = Readonly<{ generationId: string; release(): Promise<void> }>;

type Session = {
  id: string;
  scope: BrowserScope;
  state: BrowserSessionView["state"];
  owner?: "agent" | "human";
  epoch: number;
  created: number;
  touched: number;
  absoluteExpiry: number;
  released: boolean;
  environment: BrowserEnvironmentHandle;
  active?: AbortController;
  expiryTimer?: ReturnType<typeof setTimeout>;
  error?: string;
};
export class BrowserController {
  readonly #sessions = new Map<string, Session>();
  readonly #exec: BrowserExec;
  readonly #admitPlan: BrowserPlanAdmission;
  readonly #admit: BrowserAdmission;
  readonly #audit: BrowserAudit;
  readonly #acquire: (scope: BrowserScope) => Promise<BrowserEnvironmentHandle>;
  readonly #revokeView: (scope: BrowserScope, sessionId: string) => void | Promise<void>;
  readonly #now: () => number;
  constructor(options: {
    exec: BrowserExec;
    admitPlan: BrowserPlanAdmission;
    admit: BrowserAdmission;
    audit?: BrowserAudit;
    acquire: (scope: BrowserScope) => Promise<BrowserEnvironmentHandle>;
    revokeView: (scope: BrowserScope, sessionId: string) => void | Promise<void>;
    now?: () => number;
  }) {
    this.#exec = options.exec;
    this.#admitPlan = options.admitPlan;
    this.#admit = options.admit;
    this.#audit = options.audit ?? (() => {});
    this.#acquire = options.acquire;
    this.#revokeView = options.revokeView;
    this.#now = options.now ?? Date.now;
  }
  async start(scope: BrowserScope): Promise<BrowserSessionView> {
    await this.cleanup();
    const active = [...this.#sessions.values()].filter(
      (s) => !["stopped", "error"].includes(s.state),
    );
    const existing = active.find((s) => sameScope(s.scope, scope));
    if (existing) return this.view(existing);
    if (active.length > 0)
      throw new Error("Browser runtime quota is already in use");
    const now = this.#now();
    const environment = await this.#acquire(scope);
    const session: Session = {
      id: randomUUID(),
      scope,
      state: "starting",
      epoch: 0,
      created: now,
      touched: now,
      absoluteExpiry: now + ABSOLUTE_TTL_MS,
      released: false,
      environment,
    };
    this.#sessions.set(session.id, session);
    this.scheduleExpiry(session);
    let result: BrowserExecResult;
    try {
      result = await this.#exec({ intent: "ensure", sessionId: session.id, controlEpoch: 0 });
    } catch {
      result = { ok: false };
    }
    if (!result.ok) {
      session.state = "error";
      session.error = "Browser runtime could not start.";
      const cleanup = await this.#exec({ intent: "stop", sessionId: session.id, controlEpoch: 1 }).catch(() => ({ ok: false }));
      if (cleanup.ok) await this.finish(session);
      else session.error = "Browser cleanup requires reconciliation.";
      return this.view(session);
    }
    session.state = "agent-controlled";
    session.owner = "agent";
    await this.event(session, "started");
    return this.view(session);
  }
  status(scope: BrowserScope, id: string): BrowserSessionView {
    return this.view(this.require(scope, id));
  }
  async observe(
    scope: BrowserScope,
    id: string,
    epoch: number,
  ): Promise<{ observation: BrowserObservation; controlEpoch: number }> {
    const s = this.requireAgent(scope, id, epoch);
    this.touch(s);
    const result = await this.#exec({
      intent: "observe",
      sessionId: id,
      controlEpoch: epoch,
    });
    if (!result.ok) throw new Error("Browser observation failed");
    return {
      observation: parseObservation(result.stdout ?? ""),
      controlEpoch: s.epoch,
    };
  }
  async act(
    scope: BrowserScope,
    input: unknown,
    signal: AbortSignal | undefined,
    identity: BrowserExecutionIdentity,
  ): Promise<{ planHash: string; results: readonly string[] }> {
    const plan = parseActionPlan(input);
    const s = this.requireAgent(scope, plan.sessionId, plan.controlEpoch);
    if (s.active) throw new Error("Another browser action is active");
    const active = new AbortController();
    s.active = active;
    const abort = () => active.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const planHash = createHash("sha256")
      .update(canonicalPlan(plan))
      .digest("hex");
    const planAdmission = await this.#admitPlan({ scope, identity, planHash, plan });
    if (!planAdmission.admitted) {
      signal?.removeEventListener("abort", abort);
      s.active = undefined;
      throw new Error("Browser action plan was not admitted");
    }
    const identityFields = { toolCallId: identity.toolCallId, ...(identity.requestId ? { requestId: identity.requestId } : {}) };
    await this.event(s, "plan-admitted", { planHash, approvalRef: planAdmission.approvalRef, ...identityFields });
    const results: string[] = [];
    try {
      for (let index = 0; index < plan.actions.length; index++) {
        if (active.signal.aborted) throw new Error("Browser action aborted");
        this.requireAgent(scope, s.id, plan.controlEpoch);
        const action = plan.actions[index]!;
        const auditFields =
          action.kind === "navigate"
            ? { origin: new URL(action.url).origin }
            : {};
        await this.event(s, "action-requested", {
          planHash,
          actionIndex: index,
          ...auditFields,
        });
        const admission = await this.#admit({
          scope,
          identity,
          planHash,
          action,
          actionIndex: index,
        });
        if (!admission.admitted) {
          await this.event(s, "action-denied", {
            planHash,
            actionIndex: index,
          });
          throw new Error(`Browser action ${index} was not admitted`);
        }
        await this.event(s, "action-admitted", {
          planHash,
          actionIndex: index,
          approvalRef: admission.approvalRef,
          ...auditFields,
        });
        this.requireAgent(scope, s.id, plan.controlEpoch);
        let result: BrowserExecResult;
        try {
          result = await this.#exec({ intent: "act", sessionId: s.id, controlEpoch: s.epoch, payload: JSON.stringify(action), signal: active.signal });
        } catch { result = { ok: false }; }
        if (!result.ok) {
          await this.event(s, "action-unknown", {
            planHash,
            actionIndex: index,
          }).catch(() => undefined);
          throw new Error(`Browser action ${index} outcome is unknown`);
        }
        results.push(sanitize(result.stdout ?? "ok"));
        await this.event(s, "action-settled", {
          planHash,
          actionIndex: index,
          approvalRef: admission.approvalRef,
        }).catch(() => undefined);
      }
      this.touch(s);
      return { planHash, results: Object.freeze(results) };
    } finally {
      signal?.removeEventListener("abort", abort);
      if (s.active === active) s.active = undefined;
    }
  }
  async takeover(scope: BrowserScope, id: string): Promise<BrowserSessionView> {
    const s = this.require(scope, id);
    if (s.state !== "agent-controlled")
      throw new Error("Browser is not agent-controlled");
    s.epoch++;
    s.owner = undefined;
    s.state = "starting";
    s.active?.abort();
    await this.#revokeView(s.scope, s.id);
    let result: BrowserExecResult;
    try { result = await this.#exec({ intent: "takeover", sessionId: id, controlEpoch: s.epoch }); }
    catch { result = { ok: false }; }
    if (!result.ok) {
      s.owner = "agent";
      s.state = "agent-controlled";
      throw new Error("Browser takeover failed");
    }
    s.owner = "human";
    s.state = "human-controlled";
    this.touch(s);
    await this.event(s, "takeover");
    return this.view(s);
  }
  async return(
    scope: BrowserScope,
    id: string,
    consent: boolean,
  ): Promise<BrowserSessionView> {
    const s = this.require(scope, id);
    if (s.state !== "human-controlled" || consent !== true)
      throw new Error("Informed return consent is required");
    const result = await this.#exec({
      intent: "return",
      sessionId: id,
      controlEpoch: s.epoch + 1,
    });
    if (!result.ok) throw new Error("Human input could not be revoked");
    await this.#revokeView(s.scope, s.id);
    const fresh = await this.#exec({
      intent: "observe",
      sessionId: id,
      controlEpoch: s.epoch + 1,
    });
    if (!fresh.ok) throw new Error("Fresh return observation failed");
    s.epoch++;
    s.owner = "agent";
    s.state = "agent-controlled";
    this.touch(s);
    await this.event(s, "returned");
    return this.view(s);
  }
  async stop(scope: BrowserScope, id: string): Promise<BrowserSessionView> {
    const s = this.require(scope, id);
    if (s.state === "stopped") return this.view(s);
    if (s.state === "stopping") throw new Error("Browser is already stopping");
    s.state = "stopping";
    s.epoch++;
    s.active?.abort();
    let cleanupFailed = false;
    try { await this.#revokeView(s.scope, s.id); } catch { cleanupFailed = true; }
    try { const result = await this.#exec({ intent: "stop", sessionId: id, controlEpoch: s.epoch }); if (!result.ok) cleanupFailed = true; }
    catch { cleanupFailed = true; }
    s.state = cleanupFailed ? "error" : "stopped";
    s.error = cleanupFailed ? "Browser cleanup requires reconciliation." : undefined;
    s.owner = undefined;
    if (!cleanupFailed) await this.finish(s);
    await this.event(s, cleanupFailed ? "cleanup-failed" : "stopped");
    if (cleanupFailed) throw new Error("Browser cleanup requires reconciliation");
    return this.view(s);
  }
  async shutdown(): Promise<void> {
    for (const s of this.#sessions.values()) {
      if (!["stopped", "stopping"].includes(s.state)) await this.stop(s.scope, s.id);
    }
  }
  async cleanup(): Promise<void> {
    const now = this.#now();
    for (const s of this.#sessions.values())
      if (
        !["stopped", "stopping"].includes(s.state) &&
        (now - s.touched >= IDLE_TTL_MS || now >= s.absoluteExpiry)
      )
        await this.stop(s.scope, s.id);
  }
  private require(scope: BrowserScope, id: string): Session {
    const s = this.#sessions.get(id);
    if (!s || !sameScope(s.scope, scope))
      throw new Error("Browser session was not found");
    return s;
  }
  private requireAgent(
    scope: BrowserScope,
    id: string,
    epoch: number,
  ): Session {
    const s = this.require(scope, id);
    if (
      s.state !== "agent-controlled" ||
      s.owner !== "agent" ||
      s.epoch !== epoch
    )
      throw new Error("Browser control epoch is stale");
    return s;
  }
  private touch(s: Session): void {
    s.touched = this.#now();
    this.scheduleExpiry(s);
  }
  private scheduleExpiry(s: Session): void {
    clearTimeout(s.expiryTimer);
    const delay = Math.max(
      1,
      Math.min(s.touched + IDLE_TTL_MS, s.absoluteExpiry) - this.#now(),
    );
    s.expiryTimer = setTimeout(() => {
      void this.stop(s.scope, s.id).catch(() => undefined);
    }, delay);
    s.expiryTimer.unref?.();
  }
  private view(s: Session): BrowserSessionView {
    return Object.freeze({
      sessionId: s.id,
      state: s.state,
      ...(s.owner ? { owner: s.owner } : {}),
      controlEpoch: s.epoch,
      createdAt: new Date(s.created).toISOString(),
      expiresAt: new Date(
        Math.min(s.touched + IDLE_TTL_MS, s.absoluteExpiry),
      ).toISOString(),
      ...(["agent-controlled", "human-controlled"].includes(s.state)
        ? { view: BROWSER_NOVNC_TARGET }
        : {}),
      ...(s.error ? { error: s.error } : {}),
    });
  }
  private async finish(s: Session): Promise<void> {
    clearTimeout(s.expiryTimer);
    if (s.released) return;
    await s.environment.release();
    s.released = true;
  }
  private async event(
    s: Session,
    kind: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.#audit({
      kind,
      sessionId: s.id,
      controlEpoch: s.epoch,
      workspaceId: s.scope.workspaceId,
      agentSessionId: s.scope.agentSessionId,
      ...extra,
    });
  }
}
function sameScope(a: BrowserScope, b: BrowserScope): boolean {
  return (
    a.workspaceId === b.workspaceId &&
    a.userId === b.userId &&
    a.agentId === b.agentId &&
    a.agentSessionId === b.agentSessionId
  );
}
function sanitize(value: string): string {
  return value
    .replace(/(bearer|token|password|secret|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/(?:wss?|https?):\/\/[^\s]+/gi, "[redacted-url]")
    .slice(0, 1_024);
}
function parseObservation(stdout: string): BrowserObservation {
  let value: unknown;
  try { value = JSON.parse(stdout); } catch { throw new Error("Browser returned an invalid observation"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Browser returned an invalid observation");
  const record = value as Record<string, unknown>;
  let origin: string | undefined;
  if (typeof record.url === "string") {
    try { const parsed = new URL(record.url); if (["http:", "https:"].includes(parsed.protocol)) origin = parsed.origin; } catch { /* omit malformed URLs */ }
  }
  const title = typeof record.title === "string" ? sanitize(record.title).slice(0, 256) : undefined;
  const rawElements = Array.isArray(record.elements) ? record.elements : [];
  const elements = rawElements.slice(0, 200).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    if (!Number.isInteger(item.index) || (item.index as number) < 0 || (item.index as number) > 10_000) return [];
    return [Object.freeze({ index: item.index as number, ...(typeof item.role === "string" ? { role: sanitize(item.role).slice(0, 64) } : {}), ...(typeof item.text === "string" ? { text: sanitize(item.text) } : {}) })];
  });
  return Object.freeze({ ...(origin ? { origin } : {}), ...(title ? { title } : {}), elements: Object.freeze(elements) });
}
