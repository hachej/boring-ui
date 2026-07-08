import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findForbiddenPatterns, requiredExports } from "../../scripts/check-invariants.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const agentServerSpecifier = ["@hachej", "/boring-agent", "/server"].join("");
const bashSharedSpecifier = ["@hachej", "/boring-bash", "/shared"].join("");

describe("@hachej/boring-sandbox scaffold", () => {
  it("declares the scaffold export map", () => {
    const packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
    expect(Object.keys(packageJson.exports)).toEqual(expect.arrayContaining(requiredExports));
    for (const exportName of requiredExports) {
      expect(packageJson.exports[exportName]).toMatchObject({
        types: expect.stringMatching(/^\.\/dist\/.+\.d\.ts$/),
        import: expect.stringMatching(/^\.\/dist\/.+\.js$/),
      });
    }
  });

  it("resolves public shared and providers subpaths", async () => {
    const shared = await import("@hachej/boring-sandbox/shared");
    const providers = await import("@hachej/boring-sandbox/providers");

    expect(shared.PROVIDER_CAPABILITIES.direct.fs).toBe("readwrite");
    expect(shared.MODE_TO_PROVIDER.local).toBe("bwrap");
    expect(providers).toBeDefined();
  });


  it("allows only type-only agent imports", () => {
    expect(
      findForbiddenPatterns(
        "src/providers/fixture.ts",
        `import type { Sandbox } from '${agentServerSpecifier}';`,
      ),
    ).toEqual([]);

    expect(
      findForbiddenPatterns(
        "src/providers/fixture.ts",
        `import { ErrorCode } from '${agentServerSpecifier}';`,
      ),
    ).toContainEqual(expect.objectContaining({ name: "sandbox -> agent value import" }));
  });

  it("forbids every sandbox to boring-bash import edge", () => {
    expect(
      findForbiddenPatterns(
        "src/providers/fixture.ts",
        `import type { FilesystemBinding } from '${bashSharedSpecifier}';`,
      ),
    ).toContainEqual(expect.objectContaining({ name: "sandbox -> boring-bash import" }));
  });

  it("keeps shared front-safe", () => {
    expect(
      findForbiddenPatterns(
        "src/shared/fixture.ts",
        "import { readFileSync } from 'node:fs';\nconst bytes = Buffer.from('x');",
      ),
    ).toEqual([
      { file: "src/shared/fixture.ts", name: "shared node import" },
      { file: "src/shared/fixture.ts", name: "shared Buffer" },
    ]);
  });

  it("keeps server-only mounts out of shared", () => {
    expect(
      findForbiddenPatterns(
        "src/shared/fixture.ts",
        "import { mountRcloneS3 } from '../mounts';",
      ),
    ).toContainEqual(expect.objectContaining({ name: "shared -> mounts import" }));
  });
});
