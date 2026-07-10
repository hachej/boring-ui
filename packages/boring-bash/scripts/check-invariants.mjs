#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const repoRoot = resolve(import.meta.dirname, "../../..");
const packageRoot = resolve(import.meta.dirname, "..");
const packageJsonPath = join(packageRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const requiredExports = [".", "./shared", "./server"];
const sourceFilePattern = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const jsFilePattern = /\.(js|mjs|cjs)$/;
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
  const unknownLoads = [];
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
        } else {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          unknownLoads.push({ file, line: line + 1, kind });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { parseErrors, references, unknownLoads };
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

function isFastifySpecifier(specifier) {
  return specifier === "fastify" || specifier.startsWith("fastify/") || specifier.startsWith("@fastify/");
}

function resolveRelativeJsImport(fromFile, specifier, fileExists = (file) =>
  existsSync(file) && statSync(file).isFile()) {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    join(base, "index.js"),
    join(base, "index.mjs"),
    join(base, "index.cjs"),
  ];
  return candidates.find(fileExists);
}

function isLocalModuleSpecifier(specifier) {
  return specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("file:");
}

function createBoundedDistResolver(distRoot) {
  const canonicalRoot = realpathSync(distRoot);
  return (fromFile, specifier) => {
    const resolved = resolveRelativeJsImport(fromFile, specifier);
    if (!resolved) return undefined;
    const canonical = realpathSync(resolved);
    const fromRoot = relative(canonicalRoot, canonical);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return undefined;
    return canonical;
  };
}

function walkJsImportGraph(entry, options = {}) {
  const readModule = options.readModule ?? ((file) => readFileSync(file, "utf8"));
  const resolveImport = options.resolveImport ?? resolveRelativeJsImport;
  const visited = new Set();
  const parseErrors = [];
  const readErrors = [];
  const unknownLoads = [];
  const unresolved = [];
  const fastifyViolations = [];
  const stack = [entry];

  while (stack.length > 0) {
    const file = stack.pop();
    if (visited.has(file)) continue;
    visited.add(file);

    let text;
    try {
      text = readModule(file);
    } catch (error) {
      readErrors.push({ file, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const parsed = parseModuleReferences(file, text);
    parseErrors.push(...parsed.parseErrors);
    unknownLoads.push(...parsed.unknownLoads);
    fastifyViolations.push(...parsed.references.filter(({ specifier }) => isFastifySpecifier(specifier)));

    for (const { specifier, line } of parsed.references) {
      if (!isLocalModuleSpecifier(specifier)) continue;
      const resolved = resolveImport(file, specifier);
      if (!resolved || !jsFilePattern.test(resolved)) {
        unresolved.push({ file, line, specifier });
        continue;
      }
      stack.push(resolved);
    }
  }

  return {
    scannedFiles: visited.size,
    fastifyViolations,
    parseErrors,
    readErrors,
    unknownLoads,
    unresolved,
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
    pass("agent dependency-closure build completed for core Fastify graph scan");
    return true;
  }

  fail("agent core Fastify graph scan could not build @hachej/boring-agent");
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

  const fixtureEntry = resolve("/virtual/core/index.js");
  const fixtureNested = resolve("/virtual/core/nested.js");
  const fixtureModules = new Map([
    [fixtureEntry, "export { nested } from './nested.js'"],
    [fixtureNested, "export const nested = () => import('@fastify/static', { with: { type: 'json' } })"],
  ]);
  const fixtureGraph = walkJsImportGraph(fixtureEntry, {
    readModule(file) {
      const text = fixtureModules.get(file);
      if (text === undefined) throw new Error(`missing fixture module ${file}`);
      return text;
    },
    resolveImport(fromFile, specifier) {
      return resolveRelativeJsImport(fromFile, specifier, (file) => fixtureModules.has(file));
    },
  });
  const fastifyViolation = fixtureGraph.fastifyViolations[0];
  if (fixtureGraph.scannedFiles === 2
    && fixtureGraph.fastifyViolations.length === 1
    && fastifyViolation?.file === fixtureNested
    && fastifyViolation?.kind === "dynamic import"
    && fastifyViolation?.line === 1
    && fastifyViolation?.specifier === "@fastify/static"
    && fixtureGraph.parseErrors.length === 0
    && fixtureGraph.readErrors.length === 0
    && fixtureGraph.unknownLoads.length === 0
    && fixtureGraph.unresolved.length === 0) {
    pass("agent core graph fixture follows a nested chunk and rejects its @fastify specifier");
  } else {
    fail(`agent core graph fixture mismatch: ${JSON.stringify(fixtureGraph)}`);
  }

  const missingChunkGraph = walkJsImportGraph(fixtureEntry, {
    readModule: () => "export * from './missing.js'",
    resolveImport: () => undefined,
  });
  if (JSON.stringify(missingChunkGraph.unresolved) === JSON.stringify([{
    file: fixtureEntry,
    line: 1,
    specifier: "./missing.js",
  }])) {
    pass("agent core graph fixture fails closed on a missing relative chunk");
  } else {
    fail(`agent core graph missing-chunk fixture expected 1 unresolved import, got ${missingChunkGraph.unresolved.length}`);
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
    const agentDistRoot = join(agentPackageRoot, "dist");
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

    const buildOk = coreImport ? ensureFreshAgentDist() : false;
    const coreEntry = coreImport ? resolve(agentPackageRoot, coreImport) : undefined;
    if (!buildOk) {
      // Build/config failure already reported above.
    } else if (!coreEntry || !existsSync(coreEntry) || statSync(coreEntry).size === 0) {
      fail(`agent core Fastify graph scan: missing or empty ${relative(repoRoot, coreEntry ?? agentPackageRoot)}`);
    } else {
      const canonicalEntry = realpathSync(coreEntry);
      const result = walkJsImportGraph(canonicalEntry, {
        resolveImport: createBoundedDistResolver(agentDistRoot),
      });
      for (const violation of result.fastifyViolations) {
        fail(`agent core Fastify graph scan: ${relative(repoRoot, violation.file)}:${violation.line} imports ${violation.specifier}`);
      }
      for (const error of result.parseErrors) {
        fail(`agent core Fastify graph scan: could not parse ${relative(repoRoot, error.file)}:${error.line}: ${error.message}`);
      }
      for (const error of result.readErrors) {
        fail(`agent core Fastify graph scan: could not read ${relative(repoRoot, error.file)}: ${error.message}`);
      }
      for (const load of result.unknownLoads) {
        fail(`agent core Fastify graph scan: ${relative(repoRoot, load.file)}:${load.line} has non-literal ${load.kind}`);
      }
      for (const violation of result.unresolved) {
        fail(`agent core Fastify graph scan: ${relative(repoRoot, violation.file)}:${violation.line} has unresolved or out-of-dist import ${violation.specifier}`);
      }
      if (result.fastifyViolations.length === 0
        && result.parseErrors.length === 0
        && result.readErrors.length === 0
        && result.unknownLoads.length === 0
        && result.unresolved.length === 0) {
        pass(`agent core Fastify graph scan: no fastify specifiers in ${result.scannedFiles} dist file(s) reachable from @hachej/boring-agent/core`);
      }
    }
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
