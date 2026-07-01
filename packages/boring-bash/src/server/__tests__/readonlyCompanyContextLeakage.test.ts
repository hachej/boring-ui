import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { describe, expect, test } from "vitest";

import type { BoundFilesystemContext, FilesystemBinding } from "../../shared/index";
import {
  COMPANY_CONTEXT_FILESYSTEM_ID,
  COMPANY_CONTEXT_SENTINEL,
  FixtureCompanyContextBindingProvider,
  listFixtureProjectionFiles,
  seedCompanyContextFixture,
} from "../testing/companyContextFixtureProvider";
import { ReadonlyProjectionOperationError, createReadonlyProjectionOperations } from "../readonlyProjectionOperations";

const execFileAsync = promisify(execFile);

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

async function createDeniedFinanceProjection() {
  const sourceRoot = await mkdtemp(join(tmpdir(), "boring-company-leakage-source-"));
  await seedCompanyContextFixture(sourceRoot);
  const provider = new FixtureCompanyContextBindingProvider({
    sourceRoot,
    resolvePolicy: () => ({ allowedPathPrefixes: ["/company/hr", "/company/legal"] }),
  });
  const prepared = await provider.prepareBinding(ctx, readonlyBinding);
  return { prepared, operations: createReadonlyProjectionOperations(prepared.handle) };
}

function assertNoDeniedLeak(label: string, value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized, label).not.toContain(COMPANY_CONTEXT_SENTINEL);
  expect(serialized, label).not.toContain("budget.md");
  expect(serialized, label).not.toContain("hidden");
  expect(serialized, label).not.toContain("total");
}

describe("readonly company_context leakage and pagination safety", () => {
  test("list/find/grep/read errors and metadata do not expose denied sentinel or hidden counts", async () => {
    const { operations } = await createDeniedFinanceProjection();

    const list = await operations.list({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company" });
    console.info("[company-fs-leakage] actor=human-denied-finance op=list filesystem=company_context path=/company visible=%d sentinelScan=absent", list.entries.length);
    expect(list.entries).toEqual(["hr", "legal"]);
    assertNoDeniedLeak("list output", list);

    const findAll = await operations.find({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company" }, "*.md");
    console.info("[company-fs-leakage] actor=human-denied-finance op=find filesystem=company_context path=/company pattern=*.md visible=%d sentinelScan=absent", findAll.paths.length);
    expect(findAll.paths).toEqual([
      "/company/hr/onboarding.md",
      "/company/hr/policy.md",
      "/company/legal/contract.md",
    ]);
    assertNoDeniedLeak("find output", findAll);

    const grep = await operations.grep({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company" }, COMPANY_CONTEXT_SENTINEL);
    console.info("[company-fs-leakage] actor=human-denied-finance op=grep filesystem=company_context path=/company pattern=<sentinel> visible=%d sentinelScan=absent", grep.matches.length);
    expect(grep.matches).toEqual([]);
    assertNoDeniedLeak("grep output", grep);

    for (const [operation, invoke] of [
      ["read", () => operations.read({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/finance/budget.md" })],
      ["find", () => operations.find({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/finance/budget.md" }, "*.md")],
      ["grep", () => operations.grep({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company/finance/budget.md" }, COMPANY_CONTEXT_SENTINEL)],
    ] as const) {
      await expect(invoke()).rejects.toThrow();
      try {
        await invoke();
      } catch (err) {
        assertNoDeniedLeak(`${operation} denied error`, err);
        expect((err as ReadonlyProjectionOperationError).metadata).toMatchObject({
          filesystem: COMPANY_CONTEXT_FILESYSTEM_ID,
          path: "not_found_or_denied",
          operation,
        });
      }
    }
  });

  test("pagination is over the already-filtered visible result set and exposes no denied totals", async () => {
    const { operations } = await createDeniedFinanceProjection();

    const firstPage = await operations.find({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company" }, "*.md", { limit: 2 });
    const secondPage = await operations.find({ filesystem: COMPANY_CONTEXT_FILESYSTEM_ID, path: "/company" }, "*.md", { offset: 2, limit: 2 });
    const combined = [...firstPage.paths, ...secondPage.paths];

    console.info("[company-fs-leakage] actor=human-denied-finance op=find-page filesystem=company_context path=/company pages=%j visible=%d sentinelScan=absent", [firstPage.paths.length, secondPage.paths.length], combined.length);
    expect(firstPage.paths).toHaveLength(2);
    expect(secondPage.paths).toHaveLength(1);
    expect(combined).toEqual([
      "/company/hr/onboarding.md",
      "/company/hr/policy.md",
      "/company/legal/contract.md",
    ]);
    assertNoDeniedLeak("paginated find output", { firstPage, secondPage });
    expect("total" in firstPage).toBe(false);
    expect("hidden" in firstPage).toBe(false);
  });

  test("mounted readonly projection shell output cannot observe denied sentinel", async () => {
    const { prepared } = await createDeniedFinanceProjection();
    const visibleFiles = await listFixtureProjectionFiles(prepared.handle);
    expect(JSON.stringify(visibleFiles)).not.toContain("finance");

    try {
      await execFileAsync("grep", ["-R", COMPANY_CONTEXT_SENTINEL, prepared.handle.projectionRoot]);
      throw new Error("grep unexpectedly found denied sentinel in readonly projection");
    } catch (err) {
      const output = `${(err as { stdout?: string }).stdout ?? ""}${(err as { stderr?: string }).stderr ?? ""}`;
      console.info("[company-fs-leakage] actor=human-denied-finance op=shell-grep filesystem=company_context path=/company visible=%d sentinelScan=absent", visibleFiles.length);
      expect(output).not.toContain(COMPANY_CONTEXT_SENTINEL);
    }
  });
});
