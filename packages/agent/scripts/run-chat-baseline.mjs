import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const unitTests = [
  "src/front/chat/__tests__/PiChatPanel.test.tsx",
  "src/front/chat/__tests__/piNativeCutover.test.ts",
  "src/front/chat/components/__tests__/ComposerBar.test.tsx",
  "src/front/chat/components/__tests__/ChatNotices.test.tsx",
  "src/front/chat/components/__tests__/MessageTimeline.test.tsx",
  "src/front/chat/components/__tests__/PiTimelineMessage.test.tsx",
  "src/front/chat/components/__tests__/RuntimeNotices.test.tsx",
  "src/front/chat/components/__tests__/ToolCallGroup.adapter.test.tsx",
  "src/front/chat/pi/__tests__/piChatStream.test.ts",
  "src/front/chat/pi/__tests__/piChatReducer.test.ts",
  "src/front/chat/pi/__tests__/piChatReducer.queue.test.ts",
  "src/front/chat/pi/__tests__/piFollowUpQueueController.test.ts",
  "src/front/chat/pi/__tests__/remotePiSession.test.ts",
  "src/front/chat/pi/__tests__/selectors.test.ts",
  "src/front/chat/session/__tests__/activeSessionStorage.test.ts",
  "src/front/chat/session/__tests__/composerPolicy.test.ts",
  "src/front/chat/session/__tests__/SessionList.test.tsx",
  "src/front/chat/session/__tests__/usePiSessions.test.tsx",
  "src/front/__tests__/agentPlaygroundDefaults.test.tsx",
  "src/front/__tests__/agentPlaygroundShowcase.test.tsx",
  "src/__tests__/agentPlaygroundSourceAlias.test.ts",
  "src/front/__tests__/ModelSelect.test.tsx",
  "src/front/hooks/__tests__/useChatModelSelection.test.tsx",
  "src/front/__tests__/toolRenderers.test.tsx",
  "src/front/__tests__/toolRenderers.pi.test.tsx",
  "src/front/primitives/__tests__/message.test.tsx",
  "src/front/primitives/__tests__/tool-call-group.test.tsx",
  "src/server/http/routes/__tests__/piChat.test.ts",
  "src/server/pi-chat/__tests__/harnessPiChatService.test.ts",
  "src/server/pi-chat/__tests__/harnessPiChatService.realLoop.test.ts",
  "src/server/pi-chat/__tests__/PiAgentSessionAdapter.test.ts",
  "src/server/pi-chat/__tests__/piChatEvents.test.ts",
  "src/server/pi-chat/__tests__/piChatHistory.test.ts",
  "src/server/pi-chat/__tests__/piChatReplayBuffer.test.ts",
  "src/server/pi-chat/__tests__/piChatSnapshot.test.ts",
  "src/server/pi-chat/__tests__/piSessionIdentity.test.ts",
];

const e2eTests = [
  "e2e/pi-native-chat.spec.ts",
  "e2e/pi-native-chat-reload.spec.ts",
  "e2e/pi-native-baseline-message-flow.spec.ts",
  "e2e/pi-native-baseline-history.spec.ts",
  "e2e/pi-native-baseline-composer-controls.spec.ts",
  "e2e/pi-native-standalone-playground-smoke.spec.ts",
  "e2e/pi-native-playground-showcase.spec.ts",
  "e2e/pi-native-multi-session-cold-reload.spec.ts",
  "e2e/pi-native-long-transcript-reload.spec.ts",
  "e2e/pi-native-replay-gap.spec.ts",
  "e2e/pi-native-error-scope.spec.ts",
  "e2e/pi-native-harness-baseline-message-flow.spec.ts",
  "e2e/pi-native-harness-tool-liveness.spec.ts",
  "e2e/pi-native-harness-reasoning-parts.spec.ts",
  "e2e/pi-native-harness-queue-stop-reload.spec.ts",
  "e2e/pi-native-property-baseline.spec.ts",
  "e2e/pi-native-random-baseline.spec.ts",
];

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
  console.log(`Usage: pnpm run test:chat-baseline [--unit] [--e2e]

Runs the deterministic Pi-native chat quality baseline.

Options:
  --unit  Run only focused Vitest coverage.
  --e2e   Run only deterministic Playwright baseline specs.
`);
  process.exit(0);
}

const runUnit = requested.has("--unit") || !requested.has("--e2e");
const runE2e = requested.has("--e2e") || !requested.has("--unit");
const selectedTests = [
  ...(runUnit ? unitTests : []),
  ...(runE2e ? e2eTests : []),
];
const missingTests = selectedTests.filter((file) => !existsSync(file));

if (missingTests.length > 0) {
  console.error("Chat baseline references missing test file(s):");
  for (const file of missingTests) console.error(`  ${file}`);
  process.exit(1);
}

let exitCode = 0;

if (runUnit) {
  exitCode = await run("pnpm", ["exec", "vitest", "run", ...unitTests]);
}

if (exitCode === 0 && runE2e) {
  exitCode = await run(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "-c",
      "e2e/playwright.config.ts",
      "--retries=0",
      "--global-timeout=600000",
      ...e2eTests,
    ],
    {
      env: {
        ...process.env,
        CI: "true",
        CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING ?? "1",
      },
    },
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
