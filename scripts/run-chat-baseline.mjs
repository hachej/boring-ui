import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const workspaceUnitTestCases = [
  {
    packagePath: "src/app/front/__tests__/WorkspaceAgentFront.test.tsx",
    rootPath:
      "packages/workspace/src/app/front/__tests__/WorkspaceAgentFront.test.tsx",
    name: "injects a workspace-owned plugin reload callback into the chat panel",
  },
  {
    packagePath:
      "src/front/agentPlugins/__tests__/registerAgentPlugin.test.tsx",
    rootPath:
      "packages/workspace/src/front/agentPlugins/__tests__/registerAgentPlugin.test.tsx",
    name: "command-originated /reload reconnects and re-imports replayed same-revision plugins without lifecycle loops",
  },
];

const workspaceUnitTests = workspaceUnitTestCases.map(
  (testCase) => testCase.packagePath,
);
const workspaceUnitNamePattern = workspaceUnitTestCases
  .map((testCase) => testCase.name)
  .join("|");

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const requested = new Set(args);
const allowedArgs = new Set(["--unit", "--e2e", "--help"]);
const unknownArgs = args.filter((arg) => !allowedArgs.has(arg));

if (unknownArgs.length > 0) {
  console.error(
    `Unknown test:chat-baseline option(s): ${unknownArgs.join(", ")}`,
  );
  console.error("Use --help for usage.");
  process.exit(1);
}

if (requested.has("--help")) {
  console.log(`Usage: pnpm test:chat-baseline [--unit] [--e2e]

Runs the deterministic Pi-native chat quality baseline.

Options:
  --unit  Run focused Vitest coverage, including workspace plugin reload composition.
  --e2e   Run only deterministic Playwright baseline specs.
`);
  process.exit(0);
}

const runUnit = requested.has("--unit") || !requested.has("--e2e");
const runE2e = requested.has("--e2e") || !requested.has("--unit");
const invalidWorkspaceTests = runUnit
  ? workspaceUnitTestCases.filter((testCase) => {
      if (!existsSync(testCase.rootPath)) return true;
      return !readFileSync(testCase.rootPath, "utf8").includes(testCase.name);
    })
  : [];

if (invalidWorkspaceTests.length > 0) {
  console.error("Chat baseline references missing workspace test case(s):");
  for (const testCase of invalidWorkspaceTests) {
    console.error(`  ${testCase.rootPath}: ${testCase.name}`);
  }
  process.exit(1);
}

let exitCode = await run(
  "pnpm",
  [
    "--filter",
    "@hachej/boring-agent",
    "run",
    "test:chat-baseline",
    "--",
    ...(runUnit && !runE2e ? ["--unit"] : []),
    ...(runE2e && !runUnit ? ["--e2e"] : []),
  ],
);

if (exitCode === 0 && runUnit) {
  exitCode = await run(
    "pnpm",
    [
      "--filter",
      "@hachej/boring-workspace",
      "exec",
      "vitest",
      "run",
      ...workspaceUnitTests,
      "--testNamePattern",
      workspaceUnitNamePattern,
    ],
  );
}

process.exit(exitCode);

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    console.log(`\n$ ${[command, ...args].join(" ")}`);
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
    });
    child.on("error", (error) => {
      console.error(`Failed to start ${command}: ${error.message}`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
