import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "vitest";

import type { BoundFilesystemContext, FilesystemBinding } from "../../shared/index";
import {
  COMPANY_CONTEXT_FILESYSTEM_ID,
  COMPANY_CONTEXT_SENTINEL,
  FixtureCompanyContextBindingProvider,
  seedCompanyContextFixture,
} from "../testing/companyContextFixtureProvider";
import {
  READONLY_PROJECTION_INVALID_PATH_CODE,
  READONLY_PROJECTION_MUTATION_CODE,
  ReadonlyProjectionOperationError,
  createReadonlyProjectionOperations,
} from "../readonlyProjectionOperations";

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

async function createOps() {
  const sourceRoot = await mkdtemp(join(tmpdir(), "boring-company-ops-source-"));
  await seedCompanyContextFixture(sourceRoot);
  const provider = new FixtureCompanyContextBindingProvider({
    sourceRoot,
    resolvePolicy: () => ({ allowedPathPrefixes: ["/company/hr", "/company/legal"] }),
  });
  const prepared = await provider.prepareBinding(ctx, readonlyBinding);
  return createReadonlyProjectionOperations(prepared.handle);
}

describe("createReadonlyProjectionOperations", () => {
  test("reads, lists, finds, and greps only projected company files", async () => {
    const ops = await createOps();

    await expect(ops.read({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/hr/policy.md" }))
      .resolves.toMatchObject({ content: expect.stringContaining("HR policy") });
    await expect(ops.read({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/finance/budget.md" }))
      .rejects.toThrow();

    await expect(ops.list({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company" }))
      .resolves.toMatchObject({ entries: ["hr", "legal"] });
    await expect(ops.find({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company" }, "*.md"))
      .resolves.toMatchObject({ paths: [
        "/company/hr/onboarding.md",
        "/company/hr/policy.md",
        "/company/legal/contract.md",
      ] });

    const grep = await ops.grep({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company" }, "policy");
    expect(grep.matches.map((match) => match.path)).toContain("/company/hr/policy.md");
    expect(JSON.stringify(grep)).not.toContain(COMPANY_CONTEXT_SENTINEL);
  });

  test("rejects readonly mutations with stable metadata", async () => {
    const ops = await createOps();
    expect(() => ops.rejectMutation("write", { filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/hr/policy.md" }))
      .toThrow(ReadonlyProjectionOperationError);
    try {
      ops.rejectMutation("write", { filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/hr/policy.md" });
    } catch (err) {
      expect((err as ReadonlyProjectionOperationError).code).toBe(READONLY_PROJECTION_MUTATION_CODE);
      expect((err as ReadonlyProjectionOperationError).metadata).toEqual({
        filesystem: COMPANY_CONTEXT_FILESYSTEM_ID,
        path: "readonly",
        operation: "write",
      });
    }
  });

  test("rejects filesystem path spoofing", async () => {
    const ops = await createOps();
    await expect(ops.read({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "company_context:/company/hr/policy.md" }))
      .rejects.toMatchObject({ code: READONLY_PROJECTION_INVALID_PATH_CODE });
    await expect(ops.read({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/../finance/budget.md" }))
      .rejects.toMatchObject({ code: READONLY_PROJECTION_INVALID_PATH_CODE });
  });
});
