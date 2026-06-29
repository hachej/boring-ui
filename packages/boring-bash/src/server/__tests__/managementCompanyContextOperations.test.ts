import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "vitest";

import type { BoundFilesystemContext, FilesystemBinding, FilesystemBindingResolver } from "../../shared/index";
import type { CompanyContextFixturePreparedHandle, FilesystemRuntimeLifecycleEvent } from "../index";
import {
  COMPANY_CONTEXT_FILESYSTEM_ID,
  COMPANY_CONTEXT_SENTINEL,
  FixtureCompanyContextBindingProvider,
  ScopedFilesystemRuntimeBindingManager,
  createManagementProjectionOperations,
  createReadonlyProjectionOperations,
  seedCompanyContextFixture,
} from "../index";

const readonlyBinding: FilesystemBinding = {
  filesystem: COMPANY_CONTEXT_FILESYSTEM_ID,
  access: "readonly",
  mountPath: "/company_context",
  projection: "policy-filtered",
};

const managementBinding: FilesystemBinding = {
  filesystem: COMPANY_CONTEXT_FILESYSTEM_ID,
  access: "readwrite",
  mountPath: "/company_context",
  projection: "management",
};

const normalCtx: BoundFilesystemContext = {
  humanUserId: "human-1",
  agentId: "agent-normal",
  sessionId: "session-normal",
  workspaceId: "workspace-1",
  requestId: "runtime-normal",
};

const managementCtx: BoundFilesystemContext = {
  humanUserId: "human-1",
  agentId: "agent-management",
  sessionId: "session-management",
  workspaceId: "workspace-1",
  requestId: "runtime-management",
};

function logManagementE2e(event: {
  readonly profile: "normal" | "management";
  readonly sessionId: string;
  readonly requestId: string;
  readonly bindings: readonly string[];
  readonly preparedLabels?: readonly string[];
  readonly operation: string;
  readonly result: string;
}): void {
  console.info(
    "[company-fs-management-e2e] profile=%s session=%s request=%s bindings=%j prepared=%j op=%s result=%s sentinelScan=absent",
    event.profile,
    event.sessionId,
    event.requestId,
    event.bindings,
    event.preparedLabels ?? [],
    event.operation,
    event.result,
  );
}

describe("management company_context operations", () => {
  test("management write/edit updates provider state visible to later readonly projections without exposing denied content", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "boring-company-source-"));
    await seedCompanyContextFixture(sourceRoot);

    let grantManagementBinding = true;
    const provider = new FixtureCompanyContextBindingProvider({
      sourceRoot,
      resolvePolicy: (ctx) => ({
        allowedPathPrefixes: ctx.requestId === managementCtx.requestId ? ["/company"] : ["/company/hr"],
        grantManagementBinding: ctx.requestId === managementCtx.requestId && grantManagementBinding,
      }),
    });
    const resolver: FilesystemBindingResolver = {
      resolveBindings: async (ctx) => (
        ctx.requestId === managementCtx.requestId && grantManagementBinding ? [managementBinding] : [readonlyBinding]
      ),
    };
    const lifecycleEvents: FilesystemRuntimeLifecycleEvent[] = [];
    const manager = new ScopedFilesystemRuntimeBindingManager({
      resolver,
      providers: { [COMPANY_CONTEXT_FILESYSTEM_ID]: provider },
      onLifecycleEvent: (event) => lifecycleEvents.push(event),
    });

    const managementPlan = await manager.prepareRuntime(managementCtx);
    logManagementE2e({
      profile: "management",
      sessionId: managementCtx.sessionId,
      requestId: managementCtx.requestId,
      bindings: managementPlan.bindings.map((binding) => `${binding.binding.filesystem}:${binding.binding.access}:${binding.binding.projection}`),
      preparedLabels: managementPlan.bindings.map((binding) => binding.preparedLabel),
      operation: "prepare",
      result: "readwrite-management-granted",
    });
    const managementHandle = managementPlan.bindings[0].handle as CompanyContextFixturePreparedHandle;
    const managementOps = createManagementProjectionOperations(managementHandle);

    await managementOps.write(
      { filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/hr/managed.md" },
      "# Managed\nVisible to HR readers.\n",
    );
    await managementOps.edit(
      { filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/hr/policy.md" },
      "Vacation",
      "Vacation, sick leave, and parental leave",
    );
    await managementOps.write(
      { filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/finance/new-secret.md" },
      `# Finance secret\n${COMPANY_CONTEXT_SENTINEL}\n`,
    );
    logManagementE2e({
      profile: "management",
      sessionId: managementCtx.sessionId,
      requestId: managementCtx.requestId,
      bindings: ["company_context:readwrite:management"],
      preparedLabels: managementPlan.bindings.map((binding) => binding.preparedLabel),
      operation: "write-edit",
      result: "provider-state-updated-denied-content-redacted",
    });

    const readonlyPlan = await manager.prepareRuntime(normalCtx);
    logManagementE2e({
      profile: "normal",
      sessionId: normalCtx.sessionId,
      requestId: normalCtx.requestId,
      bindings: readonlyPlan.bindings.map((binding) => `${binding.binding.filesystem}:${binding.binding.access}:${binding.binding.projection}`),
      preparedLabels: readonlyPlan.bindings.map((binding) => binding.preparedLabel),
      operation: "prepare-readonly-after-management-write",
      result: "readonly-policy-filtered",
    });
    const readonlyOps = createReadonlyProjectionOperations(readonlyPlan.bindings[0].handle as CompanyContextFixturePreparedHandle);

    await expect(readonlyOps.read({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/hr/managed.md" }))
      .resolves.toMatchObject({ content: expect.stringContaining("Visible to HR readers") });
    await expect(readonlyOps.read({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/hr/policy.md" }))
      .resolves.toMatchObject({ content: expect.stringContaining("parental leave") });
    await expect(readonlyOps.read({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/finance/new-secret.md" }))
      .rejects.toMatchObject({ metadata: { path: "not_found_or_denied" } });

    const visibleGrep = await readonlyOps.grep({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company" }, COMPANY_CONTEXT_SENTINEL);
    expect(visibleGrep.matches).toEqual([]);

    await manager.invalidate(managementCtx, COMPANY_CONTEXT_FILESYSTEM_ID);
    expect(manager.getPreparedBinding(managementCtx, { filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, access: "readwrite", projection: "management" }))
      .toBeUndefined();
    await expect(managementOps.write(
      { filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/hr/stale.md" },
      "stale write should fail",
    )).rejects.toThrow("management binding is no longer active");
    logManagementE2e({
      profile: "management",
      sessionId: managementCtx.sessionId,
      requestId: managementCtx.requestId,
      bindings: ["company_context:readwrite:management"],
      preparedLabels: managementPlan.bindings.map((binding) => binding.preparedLabel),
      operation: "invalidate-stale-write",
      result: "stale-management-handle-rejected",
    });
    grantManagementBinding = false;
    const afterRevocation = await manager.prepareRuntime(managementCtx);
    logManagementE2e({
      profile: "management",
      sessionId: managementCtx.sessionId,
      requestId: managementCtx.requestId,
      bindings: afterRevocation.bindings.map((binding) => `${binding.binding.filesystem}:${binding.binding.access}:${binding.binding.projection}`),
      preparedLabels: afterRevocation.bindings.map((binding) => binding.preparedLabel),
      operation: "prepare-after-grant-removal",
      result: "management-not-granted",
    });
    expect(afterRevocation.bindings[0].binding).toEqual(readonlyBinding);
    expect(manager.getPreparedBinding(managementCtx, { filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, access: "readwrite", projection: "management" }))
      .toBeUndefined();

    expect(lifecycleEvents.map((event) => event.type)).toEqual([
      "prepare",
      "prepare",
      "invalidate",
      "prepare",
    ]);
    expect(lifecycleEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "prepare",
        context: managementCtx,
        bindings: ["company_context:readwrite:management"],
        preparedLabels: [managementPlan.bindings[0].preparedLabel],
      }),
      expect.objectContaining({
        type: "invalidate",
        context: managementCtx,
        bindings: ["company_context:readwrite:management"],
        preparedLabels: [managementPlan.bindings[0].preparedLabel],
      }),
    ]));
    const serializedEvents = JSON.stringify(lifecycleEvents);
    expect(serializedEvents).not.toContain(COMPANY_CONTEXT_SENTINEL);
    expect(serializedEvents).not.toContain("new-secret.md");
  });

  test("non-granted management profile fails through the runtime/provider path", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "boring-company-source-"));
    await seedCompanyContextFixture(sourceRoot);
    const provider = new FixtureCompanyContextBindingProvider({
      sourceRoot,
      resolvePolicy: () => ({ allowedPathPrefixes: ["/company/hr"], grantManagementBinding: false }),
    });
    const lifecycleEvents: FilesystemRuntimeLifecycleEvent[] = [];
    const manager = new ScopedFilesystemRuntimeBindingManager({
      resolver: { resolveBindings: async () => [managementBinding] },
      providers: { [COMPANY_CONTEXT_FILESYSTEM_ID]: provider },
      onLifecycleEvent: (event) => lifecycleEvents.push(event),
    });

    await expect(manager.prepareRuntime(managementCtx)).rejects.toThrow("policy did not grant readwrite management binding");
    expect(manager.getPreparedBinding(managementCtx, { filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, access: "readwrite", projection: "management" }))
      .toBeUndefined();
    expect(lifecycleEvents).toEqual([
      expect.objectContaining({
        type: "prepare-error",
        context: managementCtx,
        bindings: ["company_context:readwrite:management"],
        preparedLabels: [],
      }),
    ]);
  });

  test("management operations require a readwrite management handle", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "boring-company-source-"));
    await seedCompanyContextFixture(sourceRoot);
    const provider = new FixtureCompanyContextBindingProvider({
      sourceRoot,
      resolvePolicy: () => ({ allowedPathPrefixes: ["/company/hr"] }),
    });

    const readonlyPrepared = await provider.prepareBinding(normalCtx, readonlyBinding);
    expect(() => createManagementProjectionOperations(readonlyPrepared.handle))
      .toThrow("requires a readwrite management binding");
  });
});
