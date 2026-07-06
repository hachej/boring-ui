#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
const packageRoot = resolve(import.meta.dirname, "..");
const packageJsonPath = join(packageRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const requiredExports = [".", "./shared", "./server"];
const sourceFilePattern = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const jsFilePattern = /\.(js|mjs|cjs)$/;
const moduleSpecifierPatterns = [
  /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g,
  /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
];
const agentBoringBashValuePatterns = [
  /\b(import|export)\s+(?!type\b)(?:[^'";]*?\s+from\s+)?["'](@hachej\/boring-bash(?:\/[^"']*)?)["']/g,
  /\b(import|require)\s*\(\s*["'](@hachej\/boring-bash(?:\/[^"']*)?)["']\s*\)/g,
];
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

function lineForIndex(text, index) {
  return text.slice(0, index).split("\n").length;
}

function moduleSpecifiers(text) {
  const specifiers = [];
  for (const pattern of moduleSpecifierPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      specifiers.push({ specifier: match[1], index: match.index });
    }
  }
  return specifiers;
}

function findAgentBoringBashValueImports(file, text) {
  const violations = [];
  for (const pattern of agentBoringBashValuePatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      violations.push({
        file,
        line: lineForIndex(text, match.index),
        kind: match[1],
        specifier: match[2],
      });
    }
  }
  return violations;
}

function isFastifySpecifier(specifier) {
  return specifier === "fastify" || specifier.startsWith("fastify/") || specifier.startsWith("@fastify/");
}

function findFastifySpecifiers(file, text) {
  return moduleSpecifiers(text)
    .filter(({ specifier }) => isFastifySpecifier(specifier))
    .map(({ specifier, index }) => ({
      file,
      line: lineForIndex(text, index),
      specifier,
    }));
}

function resolveRelativeJsImport(fromFile, specifier) {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return undefined;
  const base = specifier.startsWith("/") ? specifier : resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    join(base, "index.js"),
    join(base, "index.mjs"),
    join(base, "index.cjs"),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function walkJsImportGraph(entry) {
  const visited = new Set();
  const unresolved = [];
  const fastifyViolations = [];
  const stack = [entry];

  while (stack.length > 0) {
    const file = stack.pop();
    if (visited.has(file)) continue;
    visited.add(file);

    const text = readFileSync(file, "utf8");
    fastifyViolations.push(...findFastifySpecifiers(file, text));

    for (const { specifier, index } of moduleSpecifiers(text)) {
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) continue;
      const resolved = resolveRelativeJsImport(file, specifier);
      if (!resolved || !jsFilePattern.test(resolved)) {
        unresolved.push({
          file,
          line: lineForIndex(text, index),
          specifier,
        });
        continue;
      }
      stack.push(resolved);
    }
  }

  return { scannedFiles: visited.size, fastifyViolations, unresolved };
}

function ensureFreshAgentDist() {
  const result = spawnSync("pnpm", ["--filter", "@hachej/boring-agent...", "--workspace-concurrency=4", "run", "build"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.status === 0) {
    pass("agent dependency-closure build completed for core Fastify graph scan");
    return true;
  }

  fail("agent core Fastify graph scan could not build @hachej/boring-agent");
  if (result.stdout) console.error(result.stdout.trimEnd());
  if (result.stderr) console.error(result.stderr.trimEnd());
  return false;
}

function assertNegativeFixtures() {
  const agentValueFixture = findAgentBoringBashValueImports(
    "fixture.ts",
    [
      "import type { FilesystemBinding } from '@hachej/boring-bash/shared'",
      "import { createBashAgentFeature } from '@hachej/boring-bash/server'",
      "const loaded = await import('@hachej/boring-bash')",
    ].join("\n"),
  );
  if (agentValueFixture.length === 2) {
    pass("agent import-cycle scan fixture rejects value/dynamic boring-bash imports and allows type-only imports");
  } else {
    fail(`agent import-cycle scan fixture expected 2 violations, got ${agentValueFixture.length}`);
  }

  const fastifyFixture = findFastifySpecifiers(
    "dist/core/fixture.js",
    [
      "import Fastify from 'fastify'",
      "const staticPlugin = await import('@fastify/static')",
    ].join("\n"),
  );
  if (fastifyFixture.length === 2) {
    pass("agent core Fastify graph fixture rejects fastify and @fastify specifiers");
  } else {
    fail(`agent core Fastify graph fixture expected 2 violations, got ${fastifyFixture.length}`);
  }
}

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
const agentFiles = readdirSync(join(repoRoot, "packages", "agent"), { withFileTypes: true }).length
  ? walk(agentSrc)
  : [];
{
  const violations = [];
  for (const file of agentFiles) {
    violations.push(...findAgentBoringBashValueImports(file, readFileSync(file, "utf8")));
  }
  for (const violation of violations) {
    fail(`agent import-cycle scan: ${violation.kind} ${violation.specifier} found in ${relative(repoRoot, violation.file)}:${violation.line}`);
  }
  if (violations.length === 0) pass(`agent import-cycle scan: no boring-bash value imports in ${agentFiles.length} file(s)`);
}

assertNegativeFixtures();

{
  const agentPackageRoot = join(repoRoot, "packages", "agent");
  const agentPackageJson = JSON.parse(readFileSync(join(agentPackageRoot, "package.json"), "utf8"));
  const coreExport = agentPackageJson.exports?.["./core"];
  if (coreExport?.types && coreExport?.import) {
    pass(`agent export ./core -> types=${coreExport.types} import=${coreExport.import}`);
  } else {
    fail("agent package missing complete ./core export");
  }

  const coreEntry = join(agentPackageRoot, coreExport?.import ?? "dist/core/index.js");
  const buildOk = ensureFreshAgentDist();
  if (!buildOk) {
    // Build failure already reported above.
  } else if (!existsSync(coreEntry)) {
    fail(`agent core Fastify graph scan: missing ${relative(repoRoot, coreEntry)}; run "pnpm --filter @hachej/boring-agent run build" first`);
  } else {
    const result = walkJsImportGraph(coreEntry);
    for (const violation of result.fastifyViolations) {
      fail(`agent core Fastify graph scan: ${relative(repoRoot, violation.file)}:${violation.line} imports ${violation.specifier}`);
    }
    for (const violation of result.unresolved) {
      fail(`agent core Fastify graph scan: ${relative(repoRoot, violation.file)}:${violation.line} has unresolved relative import ${violation.specifier}`);
    }
    if (result.fastifyViolations.length === 0 && result.unresolved.length === 0) {
      pass(`agent core Fastify graph scan: no fastify specifiers in ${result.scannedFiles} dist file(s) from @hachej/boring-agent/core`);
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

if (process.exitCode) process.exit(process.exitCode);
pass("all PR1 boring-bash invariant checks completed");
