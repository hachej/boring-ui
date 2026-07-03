import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "vitest";

import type { BoundFilesystemContext, FilesystemBinding } from "../../shared/index";
import {
  COMPANY_CONTEXT_FILESYSTEM_ID,
  COMPANY_CONTEXT_SENTINEL,
  FixtureCompanyContextBindingProvider,
  listFixtureProjectionFiles,
  readFixtureProjectionFile,
  seedCompanyContextFixture,
} from "../testing/companyContextFixtureProvider";

const ctx: BoundFilesystemContext = {
  humanUserId: "human-1",
  agentId: "agent-1",
  sessionId: "session-1",
  workspaceId: "workspace-1",
  requestId: "request-1",
};

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

async function createFixtureSource() {
  const sourceRoot = await mkdtemp(join(tmpdir(), "boring-company-source-"));
  await seedCompanyContextFixture(sourceRoot);
  return sourceRoot;
}

describe("FixtureCompanyContextBindingProvider", () => {
  test("physically projects only policy-allowed company files", async () => {
    const sourceRoot = await createFixtureSource();
    const provider = new FixtureCompanyContextBindingProvider({
      sourceRoot,
      resolvePolicy: () => ({ allowedPathPrefixes: ["/company/hr", "/company/legal"] }),
    });

    const prepared = await provider.prepareBinding(ctx, readonlyBinding);
    const visibleFiles = await listFixtureProjectionFiles(prepared.handle);

    expect(visibleFiles).toEqual([
      "/company/hr/onboarding.md",
      "/company/hr/policy.md",
      "/company/legal/contract.md",
    ]);
    await expect(readFixtureProjectionFile(prepared.handle, "/company/finance/budget.md")).rejects.toThrow();

    const projectedPolicyPath = join(prepared.handle.projectionRoot, "company", "hr", "policy.md");
    const projectedText = await readFile(projectedPolicyPath, "utf8");
    expect(projectedText).toContain("HR policy");
    await expect(writeFile(projectedPolicyPath, "mutated")).rejects.toThrow();
    await expect(writeFile(join(prepared.handle.projectionRoot, "company", "hr", "new.md"), "mutated")).rejects.toThrow();
    const allProjectedContent = await Promise.all(
      visibleFiles.map((path) => readFixtureProjectionFile(prepared.handle, path)),
    );
    expect(allProjectedContent.join("\n")).not.toContain(COMPANY_CONTEXT_SENTINEL);
  });

  test("prepares policy-granted readwrite management binding distinctly from readonly projection", async () => {
    const sourceRoot = await createFixtureSource();
    const provider = new FixtureCompanyContextBindingProvider({
      sourceRoot,
      resolvePolicy: (ctx) => ({
        allowedPathPrefixes: ctx.agentId === "curator-agent" ? ["/company"] : ["/company/hr"],
        grantManagementBinding: ctx.agentId === "curator-agent",
      }),
    });

    const readonlyPrepared = await provider.prepareBinding({ ...ctx, agentId: "normal-agent" }, readonlyBinding);
    await expect(provider.prepareBinding({ ...ctx, agentId: "normal-agent" }, managementBinding))
      .rejects.toThrow("policy did not grant readwrite management binding");
    const managementPrepared = await provider.prepareBinding({ ...ctx, agentId: "curator-agent" }, managementBinding);

    expect(readonlyPrepared.handle).toMatchObject({ access: "readonly", projection: "policy-filtered" });
    expect(managementPrepared.handle).toMatchObject({ access: "readwrite", projection: "management" });
    expect(managementPrepared.handle.projectionRoot).toBe(sourceRoot);
    expect(readonlyPrepared.handle.projectionRoot).not.toBe(managementPrepared.handle.projectionRoot);
    await expect(writeFile(join(managementPrepared.handle.projectionRoot, "company", "hr", "managed.md"), "managed"))
      .resolves.toBeUndefined();
  });

  test("generic policy resolver can withhold management binding from non-granted actors", async () => {
    const resolveBindings = (policy: { grantManagementBinding?: boolean }): FilesystemBinding[] => (
      policy.grantManagementBinding ? [managementBinding] : [readonlyBinding]
    );

    expect(resolveBindings({})).toEqual([readonlyBinding]);
    expect(resolveBindings({ grantManagementBinding: true })).toEqual([managementBinding]);
  });

  test("rejects unsupported company bindings", async () => {
    const sourceRoot = await createFixtureSource();
    const provider = new FixtureCompanyContextBindingProvider({
      sourceRoot,
      resolvePolicy: () => ({ allowedPathPrefixes: ["/company"] }),
    });

    await expect(
      provider.prepareBinding(ctx, { ...readonlyBinding, access: "readwrite" }),
    ).rejects.toThrow("only prepares readonly policy-filtered or readwrite management bindings");
    await expect(
      provider.prepareBinding(ctx, { ...readonlyBinding, projection: "management" }),
    ).rejects.toThrow("only prepares readonly policy-filtered or readwrite management bindings");
  });

  test("does not include symlink escapes in readonly projections", async () => {
    const sourceRoot = await createFixtureSource();
    const outside = await mkdtemp(join(tmpdir(), "boring-company-outside-"));
    await writeFile(join(outside, "secret.md"), COMPANY_CONTEXT_SENTINEL);
    await symlink(join(outside, "secret.md"), join(sourceRoot, "company", "hr", "escape.md"));

    const provider = new FixtureCompanyContextBindingProvider({
      sourceRoot,
      resolvePolicy: () => ({ allowedPathPrefixes: ["/company/hr"] }),
    });

    await expect(provider.prepareBinding(ctx, readonlyBinding)).rejects.toThrow("escapes company context root");
  });
});
