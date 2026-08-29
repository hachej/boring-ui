#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(import.meta.dirname, "../../..");
const packageRoot = resolve(import.meta.dirname, "..");
const packageJsonPath = join(packageRoot, "package.json");

export const requiredExports = [
  ".",
  "./shared",
  "./runtime-modes",
  "./providers",
  "./providers/registry",
  "./providers/direct",
  "./providers/bwrap",
  "./providers/node-workspace",
  "./providers/blaxel",
  "./providers/vercel-sandbox",
  "./providers/runsc",
  "./providers/remote-worker",
];

const sourceFilePattern = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const importExportFromPattern = /\b(import|export)\s+(type\s+)?[\s\S]*?\s+from\s+["']([^"']+)["']/g;
const sideEffectImportPattern = /\bimport\s+["']([^"']+)["']/g;
const dynamicImportPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const requirePattern = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

const pass = (message) => console.log(`[boring-sandbox invariant] PASS ${message}`);
const fail = (message) => {
  console.error(`[boring-sandbox invariant] FAIL ${message}`);
  process.exitCode = 1;
};

const isBoringAgentSpecifier = (specifier) =>
  specifier === "@hachej/boring-agent" || specifier.startsWith("@hachej/boring-agent/");

const isBoringBashSpecifier = (specifier) =>
  specifier === "@hachej/boring-bash" || specifier.startsWith("@hachej/boring-bash/");

const normalized = (path) => path.replaceAll("\\", "/");
const agentPackageRoot = join(repoRoot, "packages", "agent");

const resolvesIntoAgentPackage = (file, specifier) => {
  if (!specifier.startsWith(".")) return false;
  const absoluteFile = resolve(packageRoot, file);
  const target = normalized(resolve(dirname(absoluteFile), specifier));
  const agentRoot = normalized(agentPackageRoot);
  return target === agentRoot || target.startsWith(`${agentRoot}/`);
};

const isSharedFile = (file) => {
  const normalized = file.replaceAll("\\", "/");
  return normalized.includes("/src/shared/") || normalized.endsWith("/src/shared/index.ts") || normalized.startsWith("src/shared/");
};

export function findForbiddenPatterns(file, text) {
  const violations = [];
  const add = (name) => violations.push({ file, name });

  for (const match of text.matchAll(importExportFromPattern)) {
    const [, statementKind, typeKeyword, specifier] = match;
    const isTypeOnly = typeKeyword === "type ";
    if ((isBoringAgentSpecifier(specifier) || resolvesIntoAgentPackage(file, specifier)) && !isTypeOnly) {
      add(`sandbox -> agent value ${statementKind}`);
    }
    if (isBoringBashSpecifier(specifier)) {
      add(`sandbox -> boring-bash ${statementKind}`);
    }
  }

  for (const pattern of [sideEffectImportPattern, dynamicImportPattern, requirePattern]) {
    for (const match of text.matchAll(pattern)) {
      const [, specifier] = match;
      if (isBoringAgentSpecifier(specifier) || resolvesIntoAgentPackage(file, specifier)) {
        add("sandbox -> agent value import");
      }
      if (isBoringBashSpecifier(specifier)) {
        add("sandbox -> boring-bash import");
      }
    }
  }

  if (isSharedFile(file)) {
    if (/(?:from\s+["']node:|import\s+["']node:|require\(\s*["']node:)/.test(text)) {
      add("shared node import");
    }
    if (/\bBuffer\b/.test(text)) {
      add("shared Buffer");
    }
  }

  return violations;
}

const walk = (dir) => {
  const entries = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", ".git", ".worktrees"].includes(name)) continue;
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) entries.push(...walk(path));
    else if (sourceFilePattern.test(name)) entries.push(path);
  }
  return entries;
};

export function findRegistrationOwnershipViolations(file, text) {
  const violations = [];
  const relativeFile = normalized(relative(repoRoot, file));
  const allowedRegistryConsumer = "packages/agent/host/sandbox.ts";
  const registryImport = /(?:from\s+|import\s*\(\s*)["']@hachej\/boring-sandbox\/providers\/registry["']/;
  if (registryImport.test(text) && relativeFile !== allowedRegistryConsumer) {
    violations.push({ file: relativeFile, name: "provider registry imported outside the Agent host boundary" });
  }
  return violations;
}

function checkRegistrationOwnership() {
  const violations = [];
  for (const rootName of ["apps", "packages", "plugins", "tools"]) {
    const root = join(repoRoot, rootName);
    if (!statSync(root).isDirectory()) continue;
    for (const file of walk(root)) {
      if (normalized(file).startsWith(`${normalized(packageRoot)}/`)) continue;
      violations.push(...findRegistrationOwnershipViolations(file, readFileSync(file, "utf8")));
    }
  }
  return violations;
}

export function checkExports(packageJson) {
  const missing = [];
  for (const exportName of requiredExports) {
    const entry = packageJson.exports?.[exportName];
    if (!entry?.types || !entry?.import) {
      missing.push(exportName);
    }
  }
  return missing;
}

export function checkPackageInvariants(root = packageRoot) {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const missingExports = checkExports(packageJson);
  const srcFiles = walk(join(root, "src"));
  const violations = [];

  for (const file of srcFiles) {
    const text = readFileSync(file, "utf8");
    violations.push(...findForbiddenPatterns(relative(root, file), text));
  }

  return { missingExports, scannedFiles: srcFiles.length, violations };
}

export function main() {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  console.log(`[boring-sandbox invariant] package=${relative(repoRoot, packageRoot)}`);
  console.log("[boring-sandbox invariant] expected proof commands: pnpm --filter @hachej/boring-sandbox run build; pnpm --filter @hachej/boring-sandbox run typecheck; pnpm --filter @hachej/boring-sandbox run check:invariants");

  for (const exportName of requiredExports) {
    const entry = packageJson.exports?.[exportName];
    if (entry?.types && entry?.import) {
      pass(`export ${exportName} -> types=${entry.types} import=${entry.import}`);
    } else {
      fail(`missing complete export ${exportName}`);
    }
  }

  const { scannedFiles, violations } = checkPackageInvariants();
  for (const violation of violations) {
    fail(`${violation.name} found in ${violation.file}`);
  }

  if (violations.length === 0) {
    pass(`layering/front-safe scan: no forbidden patterns in ${scannedFiles} file(s)`);
  }

  const ownershipFixture = findRegistrationOwnershipViolations(
    join(repoRoot, "packages", "core", "src", "badRegistry.ts"),
    "import { sandboxRuntimeModeRegistry } from '@hachej/boring-sandbox/providers/registry'",
  );
  if (ownershipFixture.length === 1) {
    pass("provider-registry ownership negative fixture rejects external imports");
  } else {
    fail(`provider-registry ownership fixture mismatch: ${JSON.stringify(ownershipFixture)}`);
  }

  const providersBarrel = readFileSync(join(packageRoot, "src", "providers", "index.ts"), "utf8");
  if (/from\s+["']\.\/registry(?:\/[^"']+)?(?:\.js)?["']/.test(providersBarrel)) {
    fail("provider registry must not be re-exported from the general providers barrel");
  } else {
    pass("provider registry is available only through its dedicated ownership-gated export");
  }

  const registrationViolations = checkRegistrationOwnership();
  for (const violation of registrationViolations) {
    fail(`${violation.name} found in ${violation.file}`);
  }
  if (registrationViolations.length === 0) {
    pass("provider registration and registry imports stay inside boring-sandbox plus the exact Agent host lookup edge");
  }

  if (process.exitCode) process.exit(process.exitCode);
  pass("all boring-sandbox invariant checks completed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
