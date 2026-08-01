#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const repoRoot = resolve(import.meta.dirname, "..");
const workspaceTargetRoot = join(repoRoot, "packages/workspace/src/app/server");
const consumerRoots = [
  "packages/workspace/src",
  "packages/core/src",
  "packages/cli/src",
  "apps/agent-playground/src",
].map((path) => join(repoRoot, path));
const nonProductionSourcePrefixes = [
  // Scaffolding templates contain placeholders and are not executable repository sources.
  "packages/plugin-cli/templates/",
];
const sourceFilePattern = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const skippedDirs = new Set([
  ".cache",
  ".git",
  ".next",
  ".output",
  ".tmp",
  ".turbo",
  ".worktrees",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const negativeFixturesOnly = process.argv.includes("--negative-fixtures-only");
const pass = (message) => console.log(`[alignment invariant] PASS ${message}`);
const fail = (message) => {
  console.error(`[alignment invariant] FAIL ${message}`);
  process.exitCode = 1;
};

const createAgentHostAllowlist = new Set([
  // Standalone playground composition root.
  "apps/agent-playground/src/server/agentHost.ts",
  // CLI mode composition root.
  "packages/cli/src/server/modeApps.ts",
  // Core application composition root.
  "packages/core/src/app/server/createCoreWorkspaceAgentServer.ts",
  // Workspace application composition root.
  "packages/workspace/src/app/server/createWorkspaceAgentServer.ts",
  // Thin standalone composition root over the canonical Host.
  "packages/agent/src/server/createStandaloneAgentHostApp.ts",
  // Canonical factory implementation.
  "packages/agent/src/server/agent-host/createAgentHost.ts",
  // Embedded gateway machinery owned by the Agent Host.
  "packages/agent/src/server/agent-host/embeddedGateway.ts",
  // HTTP projection machinery owned by the Agent Host.
  "packages/agent/src/server/agent-host/httpProjection.ts",
  // Public Agent server barrel that exposes the factory.
  "packages/agent/src/server/index.ts",
]);

function toRepoPath(file) {
  return relative(repoRoot, file).split(sep).join("/");
}

function isTestPath(file) {
  const path = toRepoPath(file);
  return path.includes("/__tests__/")
    || path.includes("/__mocks__/")
    || /\/tests?\//.test(path)
    || /\.(test|spec)(-d)?\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path);
}

function isNonProductionSourcePath(file) {
  const path = toRepoPath(file);
  return nonProductionSourcePrefixes.some((prefix) => path.startsWith(prefix));
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name;
    if (skippedDirs.has(name)) continue;
    const path = join(dir, name);
    if (entry.isDirectory()) walk(path, files);
    else if (entry.isFile() && sourceFilePattern.test(name)) files.push(path);
  }
  return files;
}

function scriptKindFor(file) {
  switch (extname(file)) {
    case ".tsx": return ts.ScriptKind.TSX;
    case ".jsx": return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs": return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

function parseSource(file, text) {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
}

function lineFor(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
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

function unwrapTransparentExpression(node) {
  let current = node;
  while (current
    && (ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isSatisfiesExpression(current)
      || ts.isNonNullExpression(current))) {
    current = current.expression;
  }
  return current;
}

function moduleReferences(sourceFile) {
  const references = [];
  const add = (node, specifier, kind, typeOnly = false) => {
    references.push({ kind, line: lineFor(sourceFile, node), specifier, typeOnly });
  };
  const literalText = (node) => {
    const expression = unwrapTransparentExpression(node);
    return expression && ts.isStringLiteralLike(expression) ? expression.text : undefined;
  };
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
      const expression = unwrapTransparentExpression(node.expression);
      const dynamicImport = expression?.kind === ts.SyntaxKind.ImportKeyword;
      const requireCall = expression && ts.isIdentifier(expression) && expression.text === "require";
      if (dynamicImport || requireCall) {
        const specifier = node.arguments[0] ? literalText(node.arguments[0]) : undefined;
        if (specifier) add(node, specifier, dynamicImport ? "dynamic import" : "require");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function isPackageSpecifier(specifier, packageName) {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

function isAgentServerInternalSpecifier(file, specifier) {
  if (specifier.startsWith("@hachej/boring-agent/server/")
    || isPackageSpecifier(specifier, "@hachej/boring-agent/src/server")) {
    return true;
  }
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return false;
  const resolvedSpecifier = resolve(dirname(file), specifier);
  const agentServerRoot = join(repoRoot, "packages/agent/src/server");
  return resolvedSpecifier === agentServerRoot || resolvedSpecifier.startsWith(`${agentServerRoot}${sep}`);
}

function findWorkspaceImportViolations(file, sourceFile) {
  return moduleReferences(sourceFile).filter(({ specifier, typeOnly }) =>
    !typeOnly
    && (isPackageSpecifier(specifier, "@hachej/boring-bash")
      || isPackageSpecifier(specifier, "@hachej/boring-sandbox")
      || isAgentServerInternalSpecifier(file, specifier)));
}

function isCreateAgentHostReference(expression, callableNames) {
  const target = unwrapTransparentExpression(expression);
  if (target && ts.isIdentifier(target)) return callableNames.has(target.text);
  if (target && ts.isPropertyAccessExpression(target)) {
    return target.name.text === "createAgentHost";
  }
  if (target && ts.isElementAccessExpression(target) && target.argumentExpression) {
    const argument = unwrapTransparentExpression(target.argumentExpression);
    return Boolean(argument
      && ts.isStringLiteralLike(argument)
      && argument.text === "createAgentHost");
  }
  return false;
}

function findCreateAgentHostCalls(sourceFile) {
  const callableNames = new Set(["createAgentHost"]);
  const calls = [];

  const addBindingAliases = (binding, initializer) => {
    if (ts.isIdentifier(binding)) {
      if (isCreateAgentHostReference(initializer, callableNames)) {
        callableNames.add(binding.text);
      }
      return;
    }
    if (!ts.isObjectBindingPattern(binding)) return;
    for (const element of binding.elements) {
      if (element.dotDotDotToken || !ts.isIdentifier(element.name)) continue;
      const propertyName = element.propertyName ?? element.name;
      if ((ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName))
        && propertyName.text === "createAgentHost") {
        callableNames.add(element.name.text);
      }
    }
  };

  let previousSize;
  do {
    previousSize = callableNames.size;
    const collectAliases = (node) => {
      if (ts.isImportSpecifier(node)
        && (node.propertyName ?? node.name).text === "createAgentHost") {
        callableNames.add(node.name.text);
      } else if (ts.isVariableDeclaration(node) && node.initializer) {
        addBindingAliases(node.name, node.initializer);
      } else if (ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(node.left)
        && isCreateAgentHostReference(node.right, callableNames)) {
        callableNames.add(node.left.text);
      }
      ts.forEachChild(node, collectAliases);
    };
    collectAliases(sourceFile);
  } while (callableNames.size !== previousSize);

  const visit = (node) => {
    if (ts.isCallExpression(node)
      && isCreateAgentHostReference(node.expression, callableNames)) {
      calls.push({ line: lineFor(sourceFile, node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function findConsumerInternalReferences(sourceFile) {
  const references = [];
  const isConsumerInternalName = (name) =>
    name === "HarnessPiChatService" || name === "PiSessionStore";
  const visit = (node) => {
    if (ts.isIdentifier(node) && isConsumerInternalName(node.text)) {
      references.push({ line: lineFor(sourceFile, node), name: node.text });
    } else if (ts.isElementAccessExpression(node) && node.argumentExpression) {
      const argument = unwrapTransparentExpression(node.argumentExpression);
      if (argument && ts.isStringLiteralLike(argument) && isConsumerInternalName(argument.text)) {
        references.push({ line: lineFor(sourceFile, argument), name: argument.text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function parseErrors(file, sourceFile) {
  return (sourceFile.parseDiagnostics ?? []).map((diagnostic) => {
    const line = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
    return `${toRepoPath(file)}:${line}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
  });
}

function assertNegativeFixtures() {
  const workspaceFixture = parseSource("fixture.ts", [
    "import type { Bash } from '@hachej/boring-bash'",
    "import { type Sandbox } from '@hachej/boring-sandbox'",
    "export type { RuntimeMode } from '@hachej/boring-agent/server/internal'",
    "import { createBash } from '@hachej/boring-bash/server'",
    "export { createSandbox } from '@hachej/boring-sandbox'",
    "import '@hachej/boring-agent/server/internal'",
    "const sandbox = await import('@hachej/boring-sandbox')",
    "const internal = require('../../../../agent/src/server/internal')",
    "import { createAgentHost } from '@hachej/boring-agent/server'",
  ].join("\n"));
  const fixtureWorkspaceFile = join(repoRoot, "packages/workspace/src/app/server/fixture.ts");
  const workspaceActual = findWorkspaceImportViolations(fixtureWorkspaceFile, workspaceFixture)
    .map(({ kind, line, specifier }) => ({ kind, line, specifier }));
  const workspaceExpected = [
    { kind: "import", line: 4, specifier: "@hachej/boring-bash/server" },
    { kind: "export", line: 5, specifier: "@hachej/boring-sandbox" },
    { kind: "import", line: 6, specifier: "@hachej/boring-agent/server/internal" },
    { kind: "dynamic import", line: 7, specifier: "@hachej/boring-sandbox" },
    { kind: "require", line: 8, specifier: "../../../../agent/src/server/internal" },
  ];
  if (JSON.stringify(workspaceActual) === JSON.stringify(workspaceExpected)) {
    pass("fixture allows type-only/public Agent imports and rejects forbidden Workspace values");
  } else {
    fail(`Workspace import fixture mismatch: ${JSON.stringify(workspaceActual)}`);
  }

  const callFixture = parseSource("fixture.ts", [
    "import { createAgentHost as startHost } from '@hachej/boring-agent/server'",
    "createAgentHost({})",
    "agentServer.createAgentHost({})",
    "agentServer['createAgentHost']({})",
    "startHost({})",
    "const assignedHost = startHost",
    "assignedHost({})",
    "const { createAgentHost: destructuredHost } = agentServer",
    "destructuredHost({})",
    "unrelated.startHost({})",
  ].join("\n"));
  if (findCreateAgentHostCalls(callFixture).length === 6) {
    pass("fixture detects direct, qualified, imported-alias, assigned, and destructured createAgentHost calls");
  } else {
    fail("createAgentHost call fixture mismatch");
  }

  const consumerFixture = parseSource(
    "fixture.ts",
    "import type { HarnessPiChatService, PiSessionStore } from './internal'",
  );
  if (findConsumerInternalReferences(consumerFixture).length === 2) {
    pass("fixture rejects consumer references even when they are type-only");
  } else {
    fail("consumer internal-reference fixture mismatch");
  }
}

function main() {
  console.log(`[alignment invariant] repo=${repoRoot}`);
  assertNegativeFixtures();
  if (negativeFixturesOnly) return;

  const allProductionFiles = walk(repoRoot)
    .filter((file) => !isTestPath(file) && !isNonProductionSourcePath(file));
  const parsedFiles = new Map();
  const sourceFor = (file) => {
    let sourceFile = parsedFiles.get(file);
    if (!sourceFile) {
      sourceFile = parseSource(file, readFileSync(file, "utf8"));
      parsedFiles.set(file, sourceFile);
    }
    return sourceFile;
  };

  const workspaceFiles = walk(workspaceTargetRoot).filter((file) => !isTestPath(file));
  const workspaceViolations = [];
  for (const file of workspaceFiles) {
    const sourceFile = sourceFor(file);
    for (const violation of findWorkspaceImportViolations(file, sourceFile)) {
      workspaceViolations.push({ file, ...violation });
    }
  }
  for (const violation of workspaceViolations) {
    fail(`Workspace target value ${violation.kind} ${violation.specifier} in ${toRepoPath(violation.file)}:${violation.line}`);
  }
  if (workspaceViolations.length === 0) {
    pass(`Workspace targets have no forbidden value imports (${workspaceFiles.length} file(s))`);
  }

  const callViolations = [];
  let createAgentHostCallCount = 0;
  for (const file of allProductionFiles) {
    const calls = findCreateAgentHostCalls(sourceFor(file));
    createAgentHostCallCount += calls.length;
    if (!createAgentHostAllowlist.has(toRepoPath(file))) {
      for (const call of calls) callViolations.push({ file, ...call });
    }
  }
  for (const violation of callViolations) {
    fail(`createAgentHost call outside composition-root allowlist in ${toRepoPath(violation.file)}:${violation.line}`);
  }
  if (callViolations.length === 0) {
    pass(`createAgentHost calls stay in the ${createAgentHostAllowlist.size}-file allowlist (${createAgentHostCallCount} call(s))`);
  }

  const consumerFiles = consumerRoots.flatMap((root) => walk(root)).filter((file) => !isTestPath(file));
  const consumerViolations = [];
  for (const file of consumerFiles) {
    for (const reference of findConsumerInternalReferences(sourceFor(file))) {
      consumerViolations.push({ file, ...reference });
    }
  }
  for (const violation of consumerViolations) {
    fail(`consumer references ${violation.name} in ${toRepoPath(violation.file)}:${violation.line}`);
  }
  if (consumerViolations.length === 0) {
    pass(`consumers hold no HarnessPiChatService/PiSessionStore references (${consumerFiles.length} file(s))`);
  }

  const errors = [];
  for (const [file, sourceFile] of parsedFiles) errors.push(...parseErrors(file, sourceFile));
  for (const error of errors) fail(`could not parse ${error}`);
  if (errors.length === 0) pass(`parsed ${parsedFiles.size} production source file(s)`);

  if (process.exitCode) process.exit(process.exitCode);
  pass("all alignment invariant checks completed");
}

main();
