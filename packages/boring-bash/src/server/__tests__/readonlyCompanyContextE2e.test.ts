import { mkdtemp } from "node:fs/promises";
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
} from "../testing/companyContextFixtureProvider";
import {
  READONLY_PROJECTION_INVALID_PATH_CODE,
  READONLY_PROJECTION_MUTATION_CODE,
  ReadonlyProjectionOperationError,
  createReadonlyProjectionOperations,
} from "../readonlyProjectionOperations";
import { checkReadonlyProjectionConformance } from "../testing/readonlyProjectionConformance";

const ctx: BoundFilesystemContext = {
  humanUserId: "human-denied-finance",
  agentId: "agent-denied-finance",
  sessionId: "session-denied-finance",
  workspaceId: "workspace-1",
  requestId: "request-1",
};

const readonlyBinding: FilesystemBinding = {
  filesystem: COMPANY_CONTEXT_FILESYSTEM_ID,
  access: "readonly",
  mountPath: "/company_context",
  projection: "policy-filtered",
};

async function createSourceRoot() {
  const sourceRoot = await mkdtemp(join(tmpdir(), "boring-company-e2e-source-"));
  await seedCompanyContextFixture(sourceRoot);
  return sourceRoot;
}

describe("readonly company_context e2e harness", () => {
  test("policy rebuild changes visible projection without denied leakage", async () => {
    const sourceRoot = await createSourceRoot();
    let allowedPathPrefixes = ["/company/hr", "/company/legal"];
    const provider = new FixtureCompanyContextBindingProvider({
      sourceRoot,
      resolvePolicy: () => ({ allowedPathPrefixes }),
    });

    const first = await provider.prepareBinding(ctx, readonlyBinding);
    expect(await listFixtureProjectionFiles(first.handle)).toEqual([
      "/company/hr/onboarding.md",
      "/company/hr/policy.md",
      "/company/legal/contract.md",
    ]);

    allowedPathPrefixes = ["/company/legal"];
    await provider.invalidateBinding?.(ctx, COMPANY_CONTEXT_FILESYSTEM_ID);
    const rebuilt = await provider.prepareBinding(ctx, readonlyBinding);
    const rebuiltVisible = await listFixtureProjectionFiles(rebuilt.handle);
    console.info("[company-fs-e2e] actor=human-denied-finance policy=legal-only filesystem=company_context op=rebuild visible=%d sentinelScan=absent", rebuiltVisible.length);

    expect(rebuiltVisible).toEqual(["/company/legal/contract.md"]);
    expect(JSON.stringify(rebuiltVisible)).not.toContain("hr");
    expect(JSON.stringify(rebuiltVisible)).not.toContain("finance");
    expect(JSON.stringify(rebuiltVisible)).not.toContain(COMPANY_CONTEXT_SENTINEL);
  });

  test("path spoofing and readonly mutations fail closed with stable sanitized errors", async () => {
    const sourceRoot = await createSourceRoot();
    const provider = new FixtureCompanyContextBindingProvider({
      sourceRoot,
      resolvePolicy: () => ({ allowedPathPrefixes: ["/company/hr", "/company/legal"] }),
    });
    const prepared = await provider.prepareBinding(ctx, readonlyBinding);
    const operations = createReadonlyProjectionOperations(prepared.handle);

    for (const path of ["company_context:/company/hr/policy.md", "/company_context/company/hr/policy.md", "/company/../finance/budget.md"]) {
      await expect(operations.read({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path }))
        .rejects.toMatchObject({ code: READONLY_PROJECTION_INVALID_PATH_CODE });
      try {
        await operations.read({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path });
      } catch (err) {
        const simulatedToolEvent = { type: "tool-error", error: err };
        expect(JSON.stringify(simulatedToolEvent)).not.toContain(COMPANY_CONTEXT_SENTINEL);
        expect(JSON.stringify(simulatedToolEvent)).not.toContain("finance");
        expect(JSON.stringify(simulatedToolEvent)).not.toContain("budget.md");
        expect((err as ReadonlyProjectionOperationError).metadata.path).toMatch(/^(invalid_path|not_found_or_denied)$/);
      }
      console.info("[company-fs-e2e] actor=human-denied-finance op=path-spoof filesystem=company_context path=<spoof> visible=0 sentinelScan=absent");
    }

    for (const path of ["/company/hr/policy.md", "/company/finance/budget.md"]) {
      try {
        operations.rejectMutation("write", { filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path });
      } catch (err) {
        expect(err).toBeInstanceOf(ReadonlyProjectionOperationError);
        expect((err as ReadonlyProjectionOperationError).code).toBe(READONLY_PROJECTION_MUTATION_CODE);
        expect((err as ReadonlyProjectionOperationError).metadata.path).toBe("readonly");
        const simulatedToolEvent = { type: "tool-error", error: err };
        expect(JSON.stringify(simulatedToolEvent)).not.toContain(COMPANY_CONTEXT_SENTINEL);
        expect(JSON.stringify(simulatedToolEvent)).not.toContain("finance");
        expect(JSON.stringify(simulatedToolEvent)).not.toContain("budget.md");
        console.info("[company-fs-e2e] actor=human-denied-finance op=write filesystem=company_context path=<readonly> visible=0 sentinelScan=absent");
      }
    }
  });

  test("unsafe projection fails reusable conformance in the e2e harness", async () => {
    const sourceRoot = await createSourceRoot();
    const unsafeHandle = {
      kind: "company-context-fixture-projection" as const,
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
    const operations = createReadonlyProjectionOperations(unsafeHandle);
    const result = await checkReadonlyProjectionConformance({
      filesystem: COMPANY_CONTEXT_FILESYSTEM_ID,
      rootPath: "/company",
      operations,
      allowedReadPath: "/company/hr/policy.md",
      deniedReadPath: "/company/finance/budget.md",
      deniedDirectoryName: "finance",
      deniedSentinel: COMPANY_CONTEXT_SENTINEL,
      allowedFindPattern: "policy.md",
      expectedAllowedFindCount: 1,
      expectedVisiblePaths: [
        "/company/hr/onboarding.md",
        "/company/hr/policy.md",
        "/company/legal/contract.md",
      ],
      projection: {
        listVisiblePaths: () => listFixtureProjectionFiles(unsafeHandle),
        writeExistingAllowedPath: async () => undefined,
        writeNewAllowedPath: async () => undefined,
        followSymlinkEscape: async () => undefined,
      },
    });

    console.info("[company-fs-e2e] actor=human-denied-finance op=unsafe-conformance filesystem=company_context path=/company visible=%d sentinelScan=failed", result.failures.length);
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });
});
