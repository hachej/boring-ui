#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";

const repoRoot = resolve(import.meta.dirname, "../../..");
const packageRoot = resolve(import.meta.dirname, "..");
const packageJsonPath = join(packageRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const requiredExports = [".", "./shared", "./server"];
const sourceFilePattern = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const negativeFixturesOnly = process.argv.includes("--negative-fixtures-only");
const pass = (message) => console.log(`[boring-bash invariant] PASS ${message}`);
const fail = (message) => {
  console.error(`[boring-bash invariant] FAIL ${message}`);
  process.exitCode = 1;
};

console.log(`[boring-bash invariant] package=${relative(repoRoot, packageRoot)}`);
console.log("[boring-bash invariant] expected proof commands: pnpm --filter @hachej/boring-bash run build; pnpm --filter @hachej/boring-bash run typecheck; pnpm --filter @hachej/boring-bash run check:invariants");

for (const exportName of requiredExports) {
  const entry = packageJson.exports?.[exportName];
  if (entry?.types && entry?.import) {
    pass(`export ${exportName} -> types=${entry.types} import=${entry.import}`);
  } else {
    fail(`missing complete export ${exportName}`);
  }
}

const walk = (dir) => {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) entries.push(...walk(path));
    else if (sourceFilePattern.test(name)) entries.push(path);
  }
  return entries;
};

function scriptKindFor(file) {
  switch (extname(file)) {
    case ".tsx": return ts.ScriptKind.TSX;
    case ".js":
    case ".mjs":
    case ".cjs": return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

function isTypeOnlyImport(node) {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)) return false;
  return clause.namedBindings.elements.length > 0
    && clause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function isTypeOnlyExport(node) {
  if (node.isTypeOnly) return true;
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return false;
  return node.exportClause.elements.length > 0
    && node.exportClause.elements.every((element) => element.isTypeOnly);
}

function parseModuleReferences(file, text) {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  const parseErrors = (sourceFile.parseDiagnostics ?? []).map((diagnostic) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    return {
      file,
      line: line + 1,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    };
  });
  const references = [];
  const add = (node, specifier, kind, typeOnly = false) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    references.push({ file, line: line + 1, kind, specifier, typeOnly });
  };
  const literalText = (node) => ts.isStringLiteralLike(node) ? node.text : undefined;

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const specifier = literalText(node.moduleSpecifier);
      if (specifier) add(node, specifier, "import", isTypeOnlyImport(node));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = literalText(node.moduleSpecifier);
      if (specifier) add(node, specifier, "export", isTypeOnlyExport(node));
    } else if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression) {
      const specifier = literalText(node.moduleReference.expression);
      if (specifier) add(node, specifier, "import equals", node.isTypeOnly);
    } else if (ts.isCallExpression(node)) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const requireCall = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (dynamicImport || requireCall) {
        const kind = dynamicImport ? "dynamic import" : "require";
        const specifier = node.arguments[0] ? literalText(node.arguments[0]) : undefined;
        if (specifier) {
          add(node, specifier, kind);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { parseErrors, references };
}

function isBoringBashSpecifier(specifier) {
  return specifier === "@hachej/boring-bash" || specifier.startsWith("@hachej/boring-bash/");
}

function findAgentBoringBashValueImports(file, text) {
  const parsed = parseModuleReferences(file, text);
  return {
    parseErrors: parsed.parseErrors,
    violations: parsed.references.filter(({ specifier, typeOnly }) =>
      !typeOnly && isBoringBashSpecifier(specifier)),
  };
}

function ensureFreshAgentDist() {
  const result = spawnSync("pnpm", ["--filter", "@hachej/boring-agent...", "--workspace-concurrency=4", "run", "build"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    shell: false,
    timeout: 10 * 60 * 1000,
  });

  if (result.status === 0) {
    pass("agent build and build-artifact invariants completed");
    return true;
  }

  fail("could not build and verify @hachej/boring-agent artifacts");
  if (result.error) console.error(result.error.message);
  if (result.stdout) console.error(result.stdout.trimEnd());
  if (result.stderr) console.error(result.stderr.trimEnd());
  return false;
}

function assertNegativeFixtures() {
  const agentValueFixture = findAgentBoringBashValueImports(
    "fixture.ts",
    [
      "import type { FilesystemBinding } from '@hachej/boring-bash/shared'",
      "import { type FilesystemPath } from '@hachej/boring-bash/shared'",
      "export { type FilesystemBinding } from '@hachej/boring-bash/shared'",
      "import { createBashAgentFeature } from '@hachej/boring-bash/server'",
      "export { createBashAgentFeature } from '@hachej/boring-bash/server'",
      "import '@hachej/boring-bash/server'",
      "const loaded = await import('@hachej/boring-bash')",
      "const required = require('@hachej/boring-bash')",
    ].join("\n"),
  );
  const agentValueActual = agentValueFixture.violations.map(({ kind, line, specifier }) =>
    ({ kind, line, specifier }));
  const agentValueExpected = [
    { kind: "import", line: 4, specifier: "@hachej/boring-bash/server" },
    { kind: "export", line: 5, specifier: "@hachej/boring-bash/server" },
    { kind: "import", line: 6, specifier: "@hachej/boring-bash/server" },
    { kind: "dynamic import", line: 7, specifier: "@hachej/boring-bash" },
    { kind: "require", line: 8, specifier: "@hachej/boring-bash" },
  ];
  if (agentValueFixture.parseErrors.length === 0
    && JSON.stringify(agentValueActual) === JSON.stringify(agentValueExpected)) {
    pass("agent import-cycle fixture rejects static/dynamic/require values and allows declaration/inline type imports");
  } else {
    fail(`agent import-cycle fixture mismatch: ${JSON.stringify({
      parseErrors: agentValueFixture.parseErrors,
      violations: agentValueActual,
    })}`);
  }
}

assertNegativeFixtures();

if (!negativeFixturesOnly) {
  const srcFiles = walk(join(packageRoot, "src"));
  const sharedFiles = srcFiles.filter((file) => file.includes(`${join("src", "shared")}${"/"}`) || file.endsWith(join("src", "shared", "index.ts")));

  const scan = (files, patterns, label) => {
    let hit = false;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const [name, pattern] of patterns) {
        if (pattern.test(text)) {
          hit = true;
          fail(`${label}: ${name} found in ${relative(repoRoot, file)}`);
        }
      }
    }
    if (!hit) pass(`${label}: no forbidden patterns in ${files.length} file(s)`);
  };

  scan(sharedFiles, [["node import", /from\s+["']node:|import\s+["']node:/], ["Buffer", /\bBuffer\b/]], "shared/front-safe scan");

  const agentSrc = join(repoRoot, "packages", "agent", "src");
  const agentFiles = existsSync(agentSrc) ? walk(agentSrc) : [];
  if (agentFiles.length === 0) fail("agent import-cycle scan: agent source tree is missing or empty");
  {
    const parseErrors = [];
    const violations = [];
    for (const file of agentFiles) {
      const result = findAgentBoringBashValueImports(file, readFileSync(file, "utf8"));
      parseErrors.push(...result.parseErrors);
      violations.push(...result.violations);
    }
    for (const error of parseErrors) {
      fail(`agent import-cycle scan: could not parse ${relative(repoRoot, error.file)}:${error.line}: ${error.message}`);
    }
    for (const violation of violations) {
      fail(`agent import-cycle scan: ${violation.kind} ${violation.specifier} found in ${relative(repoRoot, violation.file)}:${violation.line}`);
    }
    if (parseErrors.length === 0 && violations.length === 0) {
      pass(`agent import-cycle scan: no boring-bash value imports in ${agentFiles.length} file(s)`);
    }
  }

  {
    const agentPackageRoot = join(repoRoot, "packages", "agent");
    const agentPackageJson = JSON.parse(readFileSync(join(agentPackageRoot, "package.json"), "utf8"));
    const coreExport = agentPackageJson.exports?.["./core"];
    const coreImport = typeof coreExport?.import === "string" ? coreExport.import : undefined;
    if (coreExport?.types && coreImport?.startsWith("./dist/")) {
      pass(`agent export ./core -> types=${coreExport.types} import=${coreImport}`);
    } else {
      fail("agent package missing complete dist-backed ./core export");
    }
    if (!agentPackageJson.files?.includes("dist")) {
      fail("agent package files must publish dist for the ./core closure proof");
    }
    if (coreImport) ensureFreshAgentDist();
  }

  const docs = [
    "docs/issues/391/runtime-refactor/02-boring-bash-environment.md",
    "docs/issues/391/runtime-refactor/07-tests-review-acceptance.md",
  ];
  for (const doc of docs) {
    const text = readFileSync(join(repoRoot, doc), "utf8");
    if (/named filesystem bindings?/.test(text) && /\(filesystem, path\)/.test(text)) {
      pass(`${doc} mentions named filesystem bindings and (filesystem, path) identity`);
    } else {
      fail(`${doc} is missing named filesystem binding / (filesystem, path) wording`);
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);
pass(negativeFixturesOnly
  ? "all negative invariant fixtures completed"
  : "all PR1 boring-bash invariant checks completed");
