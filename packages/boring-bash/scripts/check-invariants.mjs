#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
const packageRoot = resolve(import.meta.dirname, "..");
const packageJsonPath = join(packageRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const requiredExports = [".", "./shared", "./server", "./modes"];
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
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(name)) entries.push(path);
  }
  return entries;
};

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
scan(
  agentFiles,
  [
    ["agent -> boring-bash value import", /import\s+(?!type\b)[\s\S]*?from\s+["']@hachej\/boring-bash(?:\/[^"']*)?["']/],
    ["agent -> boring-bash require", /require\(\s*["']@hachej\/boring-bash(?:\/[^"']*)?["']\s*\)/],
  ],
  "agent import-cycle scan",
);

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
