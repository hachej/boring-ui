import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test, vi } from "vitest";

import type {
  BoundFilesystemContext,
  FilesystemBinding,
  FilesystemBindingProvider,
  FilesystemBindingResolver,
  PreparedFilesystemBinding,
} from "../../shared/index";
import {
  COMPANY_CONTEXT_FILESYSTEM_ID,
  FixtureCompanyContextBindingProvider,
  ScopedFilesystemRuntimeBindingManager,
  filesystemRuntimeScopeKey,
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

async function createProvider() {
  const sourceRoot = await mkdtemp(join(tmpdir(), "boring-company-source-"));
  await seedCompanyContextFixture(sourceRoot);
  const fixtureProvider = new FixtureCompanyContextBindingProvider({
    sourceRoot,
    resolvePolicy: (ctx) => ({
      allowedPathPrefixes: ctx.requestId === managementCtx.requestId ? ["/company"] : ["/company/hr"],
      grantManagementBinding: ctx.requestId === managementCtx.requestId,
    }),
  });
  const disposeBinding = vi.fn(async (_prepared: PreparedFilesystemBinding) => undefined);
  const invalidateBinding = vi.fn<NonNullable<FilesystemBindingProvider["invalidateBinding"]>>(async () => undefined);
  const provider: FilesystemBindingProvider = {
    prepareBinding: (ctx, binding) => fixtureProvider.prepareBinding(ctx, binding),
    disposeBinding,
    invalidateBinding,
  };
  return { provider, disposeBinding, invalidateBinding };
}

describe("ScopedFilesystemRuntimeBindingManager", () => {
  test("selects management by launching a management runtime profile, not upgrading normal runtime", async () => {
    const { provider } = await createProvider();
    const resolver: FilesystemBindingResolver = {
      resolveBindings: async (ctx) => (ctx.requestId === managementCtx.requestId ? [managementBinding] : [readonlyBinding]),
    };
    const manager = new ScopedFilesystemRuntimeBindingManager({
      resolver,
      providers: { [COMPANY_CONTEXT_FILESYSTEM_ID]: provider },
    });

    const normalPlan = await manager.prepareRuntime(normalCtx);
    const managementPlan = await manager.prepareRuntime(managementCtx);

    expect(normalPlan.scopeKey).toBe(filesystemRuntimeScopeKey(normalCtx));
    expect(managementPlan.scopeKey).toBe(filesystemRuntimeScopeKey(managementCtx));
    expect(normalPlan.context).toEqual(normalCtx);
    expect(managementPlan.context).toEqual(managementCtx);
    expect(normalPlan.bindings).toHaveLength(1);
    expect(managementPlan.bindings).toHaveLength(1);
    expect(normalPlan.bindings[0].binding).toEqual(readonlyBinding);
    expect(managementPlan.bindings[0].binding).toEqual(managementBinding);

    expect(manager.getPreparedBinding(normalCtx, {
      filesystem: COMPANY_CONTEXT_FILESYSTEM_ID,
      access: "readwrite",
      projection: "management",
    })).toBeUndefined();
    expect(manager.getPreparedBinding(managementCtx, {
      filesystem: COMPANY_CONTEXT_FILESYSTEM_ID,
      access: "readwrite",
      projection: "management",
    })).toBe(managementPlan.bindings[0]);
  });

  test("normal sessions cannot reuse management handles across scoped runtime keys", async () => {
    const { provider } = await createProvider();
    const resolver: FilesystemBindingResolver = {
      resolveBindings: async (ctx) => (ctx.requestId === managementCtx.requestId ? [managementBinding] : [readonlyBinding]),
    };
    const manager = new ScopedFilesystemRuntimeBindingManager({
      resolver,
      providers: { [COMPANY_CONTEXT_FILESYSTEM_ID]: provider },
    });

    await manager.prepareRuntime(managementCtx);
    const spoofedNormalCtx = { ...managementCtx, requestId: normalCtx.requestId };

    expect(filesystemRuntimeScopeKey(spoofedNormalCtx)).not.toBe(filesystemRuntimeScopeKey(managementCtx));
    expect(manager.getPreparedBinding(spoofedNormalCtx, {
      filesystem: COMPANY_CONTEXT_FILESYSTEM_ID,
      access: "readwrite",
      projection: "management",
    })).toBeUndefined();
  });

  test("dispose and invalidate remove scoped prepared access", async () => {
    const { provider, disposeBinding, invalidateBinding } = await createProvider();
    const resolver: FilesystemBindingResolver = { resolveBindings: async () => [managementBinding] };
    const manager = new ScopedFilesystemRuntimeBindingManager({
      resolver,
      providers: { [COMPANY_CONTEXT_FILESYSTEM_ID]: provider },
    });

    await manager.prepareRuntime(managementCtx);
    expect(manager.getPreparedBinding(managementCtx, { filesystem: COMPANY_CONTEXT_FILESYSTEM_ID })).toBeDefined();

    await manager.invalidate(managementCtx, COMPANY_CONTEXT_FILESYSTEM_ID);
    expect(manager.getPreparedBinding(managementCtx, { filesystem: COMPANY_CONTEXT_FILESYSTEM_ID })).toBeUndefined();
    expect(disposeBinding).toHaveBeenCalledTimes(1);
    expect(invalidateBinding).toHaveBeenCalledWith(managementCtx, COMPANY_CONTEXT_FILESYSTEM_ID);

    await manager.prepareRuntime(managementCtx);
    expect(manager.getPreparedBinding(managementCtx, { filesystem: COMPANY_CONTEXT_FILESYSTEM_ID })).toBeDefined();
    await manager.disposeRuntime(managementCtx);
    expect(manager.getPreparedBinding(managementCtx, { filesystem: COMPANY_CONTEXT_FILESYSTEM_ID })).toBeUndefined();
    expect(disposeBinding).toHaveBeenCalledTimes(2);
  });
});
