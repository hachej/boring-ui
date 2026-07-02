import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "vitest";

import type { BoundFilesystemContext, FilesystemBinding } from "../../shared/index";
import {
  COMPANY_CONTEXT_FILESYSTEM_ID,
  COMPANY_CONTEXT_SENTINEL,
  FixtureCompanyContextBindingProvider,
  listFixtureProjectionFiles,
  seedCompanyContextFixture,
  type CompanyContextFixturePreparedHandle,
} from "../testing/companyContextFixtureProvider";
import { createReadonlyProjectionOperations } from "../readonlyProjectionOperations";
import { checkReadonlyProjectionConformance, type ReadonlyProjectionConformanceSubject } from "../testing/readonlyProjectionConformance";

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

const expectedVisiblePaths = [
  "/company/hr/onboarding.md",
  "/company/hr/policy.md",
  "/company/legal/contract.md",
];

function fixtureProjectionProbe(handle: CompanyContextFixturePreparedHandle) {
  return {
    listVisiblePaths: () => listFixtureProjectionFiles(handle),
    writeExistingAllowedPath: () => writeFile(join(handle.projectionRoot, "company", "hr", "policy.md"), "mutated"),
    writeNewAllowedPath: () => writeFile(join(handle.projectionRoot, "company", "hr", "new.md"), "mutated"),
    followSymlinkEscape: async () => {
      const sourceRoot = await mkdtemp(join(tmpdir(), "boring-company-symlink-source-"));
      await seedCompanyContextFixture(sourceRoot);
      const outside = await mkdtemp(join(tmpdir(), "boring-company-outside-"));
      await writeFile(join(outside, "secret.md"), COMPANY_CONTEXT_SENTINEL);
      await symlink(join(outside, "secret.md"), join(sourceRoot, "company", "hr", "escape.md"));
      const provider = new FixtureCompanyContextBindingProvider({
        sourceRoot,
        resolvePolicy: () => ({ allowedPathPrefixes: ["/company/hr"] }),
      });
      await provider.prepareBinding(ctx, readonlyBinding);
    },
  };
}

async function createSafeSubject(): Promise<ReadonlyProjectionConformanceSubject> {
  const sourceRoot = await mkdtemp(join(tmpdir(), "boring-company-conformance-source-"));
  await seedCompanyContextFixture(sourceRoot);
  const provider = new FixtureCompanyContextBindingProvider({
    sourceRoot,
    resolvePolicy: () => ({ allowedPathPrefixes: ["/company/hr", "/company/legal"] }),
  });
  const prepared = await provider.prepareBinding(ctx, readonlyBinding);
  return {
    filesystem: COMPANY_CONTEXT_FILESYSTEM_ID,
    rootPath: "/company",
    operations: createReadonlyProjectionOperations(prepared.handle),
    allowedReadPath: "/company/hr/policy.md",
    deniedReadPath: "/company/finance/budget.md",
    deniedDirectoryName: "finance",
    deniedSentinel: COMPANY_CONTEXT_SENTINEL,
    allowedFindPattern: "policy.md",
    expectedAllowedFindCount: 1,
    expectedVisiblePaths,
    projection: fixtureProjectionProbe(prepared.handle),
  };
}

describe("readonly projection conformance", () => {
  test("fixture/local readonly projection passes reusable conformance", async () => {
    const result = await checkReadonlyProjectionConformance(await createSafeSubject());
    expect(result).toEqual({ passed: true, failures: [] });
  });

  test("intentionally unsafe full-store projection fails conformance", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "boring-company-unsafe-source-"));
    await seedCompanyContextFixture(sourceRoot);
    const unsafeHandle: CompanyContextFixturePreparedHandle = {
      kind: "company-context-fixture-projection",
      filesystem: COMPANY_CONTEXT_FILESYSTEM_ID,
      sourceRoot,
      projectionRoot: sourceRoot,
      visiblePaths: await listFixtureProjectionFiles({
        kind: "company-context-fixture-projection",
        filesystem: COMPANY_CONTEXT_FILESYSTEM_ID,
        sourceRoot,
        projectionRoot: sourceRoot,
        visiblePaths: [],
      }),
    };

    const result = await checkReadonlyProjectionConformance({
      filesystem: COMPANY_CONTEXT_FILESYSTEM_ID,
      rootPath: "/company",
      operations: createReadonlyProjectionOperations(unsafeHandle),
      allowedReadPath: "/company/hr/policy.md",
      deniedReadPath: "/company/finance/budget.md",
      deniedDirectoryName: "finance",
      deniedSentinel: COMPANY_CONTEXT_SENTINEL,
      allowedFindPattern: "policy.md",
      expectedAllowedFindCount: 1,
      expectedVisiblePaths,
      projection: {
        ...fixtureProjectionProbe(unsafeHandle),
        followSymlinkEscape: async () => "unsafe provider followed escape",
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      "visible path set/count does not match the expected policy-filtered projection",
      "visiblePaths leaked denied directory name",
      "list leaked denied directory name",
      "find returned denied resource matches",
      "grep returned denied sentinel matches",
      "write to existing projection file unexpectedly succeeded",
      "write to new projection file unexpectedly succeeded",
      "symlink escape unexpectedly succeeded",
    ]));
  });
});
