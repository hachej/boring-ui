import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { expect, test } from "vitest"
import {
  cliRoot,
  execFile,
  makeAgentDir,
  makePublicDir,
  makeTempDir,
  runAgentDevProgram,
  runAgentDevProgramFailure,
  runCli,
  testEnv,
  writeAgentDevSubprocessHarness,
} from "./agentCommandsTestSupport.js"

test("boring-ui agent dev rejects bare, both, and missing prompt before workspace effects", async () => {
  const root = await makeAgentDir()
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml")
  const baseEnv = { BORING_UI_WORKSPACES_PATH: registryPath }

  for (const args of [
    ["agent", "dev"],
    ["agent", "dev", root],
    ["agent", "dev", root, "--prompt"],
    ["agent", "dev", root, "--prompt", "   "],
    ["agent", "dev", root, "--prompt=   "],
    ["agent", "dev", root, "--prompt", "hi", "--serve"],
    ["agent", "dev", root, "--bogus"],
    ["--json", "agent", "dev", root, "--prompt", "hi"],
  ]) {
    const failure = await runAgentDevProgramFailure(args, baseEnv)
    expect(failure.code).toBe(2)
    expect(failure.stdout).toBe("")
    expect(failure.stderr).toContain("AUTHORED_AGENT_DEV_USAGE_INVALID")
  }
  expect(existsSync(registryPath)).toBe(false)
}, 30_000)


test("@hachej/boring-ui-cli/server exported seam runs tool-bearing agent dev", async () => {
  const publicDir = await makePublicDir()
  const captureFile = join(await makeTempDir("boring-cli-agent-dev-api-capture-"), "capture.json")
  const scriptPath = await writeAgentDevSubprocessHarness(publicDir, captureFile)
  const root = await makeAgentDir({ definitionId: "api-agent", refs: { tools: ["capture.tool"] } })
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-api-registry-"), "workspaces.yaml")
  const source = (await readFile(scriptPath, "utf-8")).replace(
    /import \{ runCli \} from .+/,
    'import { runCli } from "@hachej/boring-ui-cli/server"',
  )

  const result = await execFile(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: cliRoot,
    env: testEnv({
      BORING_AGENT_DEV_ARGS: JSON.stringify(["agent", "dev", root, "--prompt", "api prompt", "--allow-direct"]),
      BORING_AGENT_DEV_CAPTURE_FILE: captureFile,
      BORING_AGENT_DEV_WITH_CATALOG: "1",
      BORING_AGENT_DEV_WITH_HARNESS: "1",
      BORING_AGENT_DEV_RUNTIME_ID: "direct",
      BORING_UI_WORKSPACES_PATH: registryPath,
    }),
    timeout: 15_000,
  })
  const capture = JSON.parse(await readFile(captureFile, "utf-8")) as Record<string, unknown>

  expect(result.stderr).toBe("")
  expect(capture.promptText).toBe("api prompt")
  expect(capture.toolInvoked).toBe(true)
  expect(capture.toolParams).toEqual({ from: "cli-dev-capture" })
  expect(capture.catalogRequest).toMatchObject({ agentTypeId: "api-agent", declaredToolRefs: ["capture.tool"] })
}, 30_000)


test("A1 trusted example validates, materializes, and dev one-shot reflects authored changes without importing authored modules", async () => {
  const exampleRoot = resolve(cliRoot, "../agent/examples/trusted-authored-agent")
  const workspaceRoot = await makeTempDir("boring-cli-a1-example-workspace-")
  const root = await makeTempDir("boring-cli-a1-example-agent-")
  await cp(exampleRoot, root, { recursive: true })

  const validation = await runCli(["agent", "validate", root, "--json"], {})
  expect(validation.stderr).toBe("")
  expect(JSON.parse(validation.stdout)).toMatchObject({
    schemaVersion: 1,
    ok: true,
    agent: {
      agentTypeId: "claims-assistant",
      refs: { tools: ["claims.lookup"] },
    },
  })
  expect(validation.stdout).not.toContain(root)

  const { materializeAgentDirectory } = await import(
    new URL(`file://${resolve(cliRoot, "../agent/dist/server/index.js")}`).href
  ) as typeof import("@hachej/boring-agent/server")
  const catalogTool = {
    name: "claims_lookup",
    description: "Trusted claims lookup",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() { return { content: [{ type: "text" as const, text: "ok" }] } },
  }
  const materialized = await materializeAgentDirectory({
    directory: root,
    expectedAgentTypeId: "claims-assistant",
    toolCatalog: new Map([["claims.lookup", catalogTool]]),
  })
  expect(materialized.instructions).toContain("authored claims assistant example")
  expect(materialized.declaredToolRefs).toEqual(["claims.lookup"])
  expect(materialized.tools.map((tool) => tool.name)).toEqual(["claims_lookup"])

  const first = await runAgentDevProgram(["agent", "dev", root, "--prompt", "claim status", "--allow-direct"], {
    BORING_AGENT_WORKSPACE_ROOT: workspaceRoot,
    BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-a1-example-registry-"), "workspaces.yaml"),
    BORING_AGENT_DEV_WITH_CATALOG: "1",
    BORING_AGENT_DEV_CATALOG_REFS: "claims.lookup",
    BORING_AGENT_DEV_EXPECT_TOOL_NAME: "claims_lookup_tool",
    BORING_AGENT_DEV_WITH_HARNESS: "1",
    BORING_AGENT_DEV_RUNTIME_ID: "direct",
  })
  expect(first.stderr).toBe("")
  expect(first.stdout).toContain("Authored agent dev one-shot completed.")
  expect(first.capture).toMatchObject({
    toolInvoked: true,
    toolName: "claims_lookup_tool",
    toolResult: "RESULT_FOR_claims_lookup_tool",
  })
  const firstPrompt = (first.capture.factoryInput as { systemPromptAppend?: string }).systemPromptAppend ?? ""
  expect(firstPrompt).toContain("authored claims assistant example")
  expect((first.capture.catalogRequest as { declaredToolRefs?: string[] }).declaredToolRefs).toEqual(["claims.lookup"])

  await writeFile(join(root, "instructions.md"), "CHANGED A1 authored prompt behavior.\n", "utf-8")
  await writeFile(join(root, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "claims-assistant",
    version: "1.0.1",
    instructionsRef: "instructions.md",
    toolRefs: ["claims.changed"],
  }, null, 2), "utf-8")
  const changed = await runAgentDevProgram(["agent", "dev", root, "--prompt", "claim status", "--allow-direct"], {
    BORING_AGENT_WORKSPACE_ROOT: workspaceRoot,
    BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-a1-example-registry-"), "workspaces.yaml"),
    BORING_AGENT_DEV_WITH_CATALOG: "1",
    BORING_AGENT_DEV_CATALOG_REFS: "claims.changed",
    BORING_AGENT_DEV_EXPECT_TOOL_NAME: "claims_changed_tool",
    BORING_AGENT_DEV_WITH_HARNESS: "1",
    BORING_AGENT_DEV_RUNTIME_ID: "direct",
  })
  expect(changed.stderr).toBe("")
  const changedPrompt = (changed.capture.factoryInput as { systemPromptAppend?: string }).systemPromptAppend ?? ""
  expect(changedPrompt).toContain("CHANGED A1 authored prompt behavior.")
  expect(changedPrompt).not.toContain("authored claims assistant example")
  expect(changed.capture).toMatchObject({
    toolInvoked: true,
    toolName: "claims_changed_tool",
    toolResult: "RESULT_FOR_claims_changed_tool",
  })
  expect(changed.capture.toolName).not.toBe(first.capture.toolName)
  expect(changed.capture.toolResult).not.toBe(first.capture.toolResult)
  expect((changed.capture.catalogRequest as { declaredToolRefs?: string[] }).declaredToolRefs).toEqual(["claims.changed"])
}, 45_000)


test("boring-ui agent dev one-shot materializes refs through trusted RunCliOptions catalog and redacts output", async () => {
  const workspaceRoot = await makeTempDir("boring-cli-agent-dev-workspace-")
  await mkdir(join(workspaceRoot, ".agents", "skills", "ambient-skill"), { recursive: true })
  await writeFile(join(workspaceRoot, ".agents", "skills", "ambient-skill", "SKILL.md"), "---\nname: ambient-skill\n---\nAMBIENT_SKILL_SECRET\n", "utf-8")
  await mkdir(join(workspaceRoot, ".pi"), { recursive: true })
  await writeFile(join(workspaceRoot, ".pi", "SYSTEM.md"), "AMBIENT_SYSTEM_SECRET\n", "utf-8")
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml")
  const root = await makeAgentDir({
    definitionId: "dev-agent",
    instructions: "AUTHORED_DEV_SECRET_PROMPT\n",
    refs: { tools: ["capture.tool"] },
  })

  const result = await runAgentDevProgram(["agent", "dev", root, "--prompt", "--USER_DEV_SECRET_PROMPT", "--allow-direct"], {
    BORING_AGENT_WORKSPACE_ROOT: workspaceRoot,
    BORING_UI_WORKSPACES_PATH: registryPath,
    BORING_AGENT_DEV_WITH_CATALOG: "1",
    BORING_AGENT_DEV_WITH_HARNESS: "1",
    BORING_AGENT_DEV_RUNTIME_ID: "direct",
  })

  expect(result.stderr).toBe("")
  expect(result.stdout).toContain("Authored agent dev one-shot completed.")
  expect(result.stdout).toContain("agent type  dev-agent")
  expect(result.stdout).toContain("runtime     local")
  expect(result.stdout).toContain("session     dev-dev-agent")
  expect(result.stdout).toContain("workspace   local:")
  expect(result.stdout).not.toContain(workspaceRoot)
  expect(result.stdout).not.toContain(root)
  expect(result.stdout).not.toContain("USER_DEV_SECRET_PROMPT")
  expect(result.stdout).not.toContain("AUTHORED_DEV_SECRET_PROMPT")
  expect(result.stdout).not.toContain("DEV_TOOL_SECRET_OUTPUT")

  expect(result.capture).toMatchObject({
    promptText: "--USER_DEV_SECRET_PROMPT",
    toolInvoked: true,
    toolParams: { from: "cli-dev-capture" },
    runtime: { create: 1, dispose: 1, mode: "direct" },
  })
  const factoryInput = result.capture.factoryInput as { systemPromptAppend?: string; tools?: string[] }
  expect(factoryInput.systemPromptAppend).toContain("AUTHORED_DEV_SECRET_PROMPT")
  expect(factoryInput.systemPromptAppend).not.toContain("AMBIENT_SKILL_SECRET")
  expect(factoryInput.systemPromptAppend).not.toContain("AMBIENT_SYSTEM_SECRET")
  expect(factoryInput.tools).toContain("dev_capture_tool")
  expect(factoryInput.tools).not.toContain("plugin_diagnostics")
  expect((result.capture.catalogRequest as { directory?: string; agentTypeId?: string; declaredToolRefs?: string[] })).toMatchObject({
    directory: root,
    agentTypeId: "dev-agent",
    declaredToolRefs: ["capture.tool"],
  })
  expect(await readFile(registryPath, "utf-8")).toContain(workspaceRoot)
}, 30_000)


test("boring-ui agent dev preserves compiler and schema error codes after lazy deps load", async () => {
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml")

  const malformed = await makeTempDir("boring-cli-agent-dev-malformed-")
  await writeFile(join(malformed, "agent.json"), "{ definitely not json", "utf-8")
  await writeFile(join(malformed, "instructions.md"), "Malformed dev prompt must not leak.\n", "utf-8")
  const malformedFailure = await runAgentDevProgramFailure(["agent", "dev", malformed, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
  })
  expect(malformedFailure.stderr.trim()).toBe('AGENT_MANIFEST_INVALID_JSON "agent.json": "agent.json must contain valid JSON"')
  expect(malformedFailure.stderr).not.toContain(malformed)
  expect(malformedFailure.stderr).not.toContain("Malformed dev prompt")

  const schema = await makeTempDir("boring-cli-agent-dev-schema-")
  await writeFile(join(schema, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "schema-agent",
    version: "1.0.0",
    instructionsRef: "instructions.md",
    deploymentId: "not-allowed",
  }), "utf-8")
  await writeFile(join(schema, "instructions.md"), "Schema dev prompt must not leak.\n", "utf-8")
  const schemaFailure = await runAgentDevProgramFailure(["agent", "dev", schema, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
  })
  expect(schemaFailure.stderr.trim()).toBe('AGENT_DEFINITION_UNSUPPORTED_FIELD "deploymentId": "deploymentId is not supported by schema version 1"')
  expect(schemaFailure.stderr).not.toContain(schema)
  expect(schemaFailure.stderr).not.toContain("Schema dev prompt")

  const missingManifest = await makeTempDir("boring-cli-agent-dev-missing-")
  await writeFile(join(missingManifest, "instructions.md"), "Missing manifest dev prompt must not leak.\n", "utf-8")
  const missingFailure = await runAgentDevProgramFailure(["agent", "dev", missingManifest, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
  })
  expect(missingFailure.stderr.trim()).toBe('AGENT_MANIFEST_NOT_FOUND "agent.json": "agent.json does not exist"')
  expect(missingFailure.stderr).not.toContain(missingManifest)
  expect(missingFailure.stderr).not.toContain("Missing manifest dev prompt")
  expect(existsSync(registryPath)).toBe(false)
}, 30_000)


test("boring-ui agent dev normalizes trusted catalog materialization errors", async () => {
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml")
  const root = await makeAgentDir({ definitionId: "catalog-get-error-agent", refs: { tools: ["capture.tool"] } })

  const failure = await runAgentDevProgramFailure(["agent", "dev", root, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
    BORING_AGENT_DEV_WITH_CATALOG: "1",
    BORING_AGENT_DEV_THROW_CATALOG_GET_SECRET: "1",
  })

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(failure.stderr.trim()).toBe('AUTHORED_AGENT_REFERENCE_UNKNOWN "toolRefs": "trusted tool catalog materialization failed"')
  expect(failure.stderr).not.toContain("CATALOG_GET_SECRET")
  expect(failure.stderr).not.toContain(root)
  expect(failure.stderr).not.toContain("/tmp/catalog-get-secret-path")
  expect(failure.stderr).not.toContain("get-secret-field")
  expect(existsSync(registryPath)).toBe(false)
}, 30_000)


test("boring-ui agent dev normalizes typed trusted catalog materialization errors", async () => {
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml")
  const root = await makeAgentDir({ definitionId: "typed-catalog-error-agent", refs: { tools: ["capture.tool"] } })

  const failure = await runAgentDevProgramFailure(["agent", "dev", root, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
    BORING_AGENT_DEV_WITH_CATALOG: "1",
    BORING_AGENT_DEV_THROW_TYPED_CATALOG_GET_SECRET: "1",
  })

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(failure.stderr.trim()).toBe('AUTHORED_AGENT_REFERENCE_UNKNOWN "toolRefs": "trusted tool catalog materialization failed"')
  expect(failure.stderr).not.toContain("TYPED_CATALOG_SECRET")
  expect(failure.stderr).not.toContain(root)
  expect(failure.stderr).not.toContain("/tmp/typed-catalog-secret-path")
  expect(failure.stderr).not.toContain("typed-secret-field")
  expect(existsSync(registryPath)).toBe(false)
}, 30_000)


test("boring-ui agent dev normalizes trusted catalog adapter thrown errors", async () => {
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml")
  const root = await makeAgentDir({ definitionId: "catalog-error-agent", refs: { tools: ["capture.tool"] } })

  const failure = await runAgentDevProgramFailure(["agent", "dev", root, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
    BORING_AGENT_DEV_WITH_CATALOG: "1",
    BORING_AGENT_DEV_THROW_CATALOG_SECRET: "1",
  })

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(failure.stderr.trim()).toBe('AUTHORED_AGENT_REFERENCE_UNKNOWN "toolRefs": "trusted tool catalog adapter failed"')
  expect(failure.stderr).not.toContain("CATALOG_SECRET")
  expect(failure.stderr).not.toContain(root)
  expect(failure.stderr).not.toContain("/tmp/catalog-secret-path")
  expect(failure.stderr).not.toContain("secret-field")
  expect(existsSync(registryPath)).toBe(false)
}, 30_000)


test("boring-ui agent dev rejects catalog TOCTOU mutations before workspace effects", async () => {
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml")
  const refsRoot = await makeAgentDir({ definitionId: "toctou-agent", refs: { tools: ["capture.tool"] } })
  const idRoot = await makeAgentDir({ definitionId: "toctou-id-agent", refs: { tools: ["capture.tool"] } })

  const refsFailure = await runAgentDevProgramFailure(["agent", "dev", refsRoot, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
    BORING_AGENT_DEV_WITH_CATALOG: "1",
    BORING_AGENT_DEV_MUTATE_REFS_DURING_CATALOG: "1",
  })
  expect(refsFailure.stderr).toContain("AUTHORED_AGENT_REFERENCE_UNKNOWN")

  const idFailure = await runAgentDevProgramFailure(["agent", "dev", idRoot, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
    BORING_AGENT_DEV_WITH_CATALOG: "1",
    BORING_AGENT_DEV_MUTATE_ID_DURING_CATALOG: "1",
  })
  expect(idFailure.stderr.trim()).toBe('AUTHORED_AGENT_REFERENCE_UNKNOWN "toolRefs": "trusted tool catalog materialization failed"')
  expect(existsSync(registryPath)).toBe(false)
}, 30_000)


test("boring-ui agent dev defaults to local-sandbox runtime without direct fallback and supports ref-free agents", async () => {
  const workspaceRoot = await makeTempDir("boring-cli-agent-dev-sandbox-workspace-")
  const root = await makeAgentDir({ definitionId: "sandbox-agent" })

  const result = await runAgentDevProgram(["agent", "dev", root, "--prompt", "sandbox prompt"], {
    BORING_AGENT_WORKSPACE_ROOT: workspaceRoot,
    BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml"),
    BORING_AGENT_DEV_WITH_HARNESS: "1",
    BORING_AGENT_DEV_RUNTIME_ID: "local",
  })

  expect(result.stderr).toBe("")
  expect(result.stdout).toContain("runtime     local-sandbox")
  expect(result.capture).toMatchObject({ runtime: { create: 1, dispose: 1, mode: "local" } })
  expect(result.capture).not.toHaveProperty("catalogRequest")
}, 30_000)


test("boring-ui agent dev one-shot emits success only after cleanup succeeds", async () => {
  const root = await makeAgentDir({ definitionId: "cleanup-agent" })

  const failure = await runAgentDevProgramFailure(["agent", "dev", root, "--prompt", "cleanup prompt", "--allow-direct"], {
    BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml"),
    BORING_AGENT_DEV_WITH_HARNESS: "1",
    BORING_AGENT_DEV_RUNTIME_ID: "direct",
    BORING_AGENT_DEV_DISPOSE_FAIL: "1",
  })

  expect(failure.code).toBe(1)
  expect(failure.stdout).not.toContain("Authored agent dev one-shot completed.")
  expect(failure.stdout).not.toContain("cleanup-agent")
  expect(failure.stderr).toContain("INTERNAL_ERROR")
  expect(failure.stderr).not.toContain("DISPOSE_SECRET")
  expect(failure.stderr).not.toContain(root)
}, 30_000)


test("boring-ui agent dev one-shot requires terminal ok and allows retry before success", async () => {
  const retryRoot = await makeAgentDir({ definitionId: "retry-agent" })
  const retry = await runAgentDevProgram(["agent", "dev", retryRoot, "--prompt", "retry prompt", "--allow-direct"], {
    BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml"),
    BORING_AGENT_DEV_WITH_HARNESS: "1",
    BORING_AGENT_DEV_RUNTIME_ID: "direct",
    BORING_AGENT_DEV_WILL_RETRY_ONCE: "1",
  })
  expect(retry.stdout).toContain("Authored agent dev one-shot completed.")
  expect(retry.capture).toMatchObject({ retryObserved: true, runtime: { dispose: 1 } })
  expect(retry.stderr).toBe("")

  for (const [env, code, leakedSecret] of [
    [{ BORING_AGENT_DEV_TERMINAL_STATUS: "error" }, "INTERNAL_ERROR", "TERMINAL_SECRET"],
    [{ BORING_AGENT_DEV_TERMINAL_STATUS: "aborted" }, "ABORTED", "terminal failure prompt"],
    [{ BORING_AGENT_DEV_ERROR_EVENT: "1" }, "INTERNAL_ERROR", "ERROR_EVENT_SECRET"],
  ] as const) {
    const root = await makeAgentDir({ definitionId: `terminal-${code.toLowerCase().replace(/_/g, "-")}` })
    const failure = await runAgentDevProgramFailure(["agent", "dev", root, "--prompt", "terminal failure prompt", "--allow-direct"], {
      BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml"),
      BORING_AGENT_DEV_WITH_HARNESS: "1",
      BORING_AGENT_DEV_RUNTIME_ID: "direct",
      ...env,
    })
    expect(failure.code).toBe(1)
    expect(failure.stdout).toBe("")
    expect(failure.stderr).toContain(code)
    expect(failure.stderr).not.toContain(leakedSecret)
    expect(failure.stderr).not.toContain(root)
  }
}, 45_000)


test("boring-ui agent dev rejects direct host mode unless --allow-direct is explicit", async () => {
  const root = await makeAgentDir()
  const failure = await runAgentDevProgramFailure(["--mode", "local", "agent", "dev", root, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml"),
  })

  expect(failure.code).toBe(2)
  expect(failure.stderr).toContain("AUTHORED_AGENT_DEV_USAGE_INVALID")
})


test("boring-ui agent dev rejects unresolved and unsupported refs without workspace side effects", async () => {
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml")
  const unresolved = await makeAgentDir({ refs: { tools: ["missing.tool"] } })
  const unsupported = await makeAgentDir({ refs: { skills: ["ambient-skill"] } })

  const missingCatalog = await runAgentDevProgramFailure(["agent", "dev", unresolved, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
  })
  expect(missingCatalog.stderr).toContain("AUTHORED_AGENT_CATALOG_REQUIRED")

  const unknownRef = await runAgentDevProgramFailure(["agent", "dev", unresolved, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
    BORING_AGENT_DEV_WITH_CATALOG: "1",
  })
  expect(unknownRef.stderr).toContain("AUTHORED_AGENT_REFERENCE_UNKNOWN")

  const unsupportedRef = await runAgentDevProgramFailure(["agent", "dev", unsupported, "--prompt", "hi"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
  })
  expect(unsupportedRef.stderr).toContain("AUTHORED_AGENT_REFERENCE_UNSUPPORTED")
  expect(existsSync(registryPath)).toBe(false)
}, 30_000)


test("boring-ui agent dev serve rejects non-loopback host before workspace effects", async () => {
  const root = await makeAgentDir({ definitionId: "nonloopback-agent" })
  const registryPath = join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml")

  const failure = await runAgentDevProgramFailure(["agent", "dev", root, "--serve"], {
    BORING_UI_WORKSPACES_PATH: registryPath,
    HOST: "0.0.0.0",
  })

  expect(failure.code).toBe(2)
  expect(failure.stdout).toBe("")
  expect(failure.stderr).toContain("AUTHORED_AGENT_DEV_USAGE_INVALID")
  expect(existsSync(registryPath)).toBe(false)
}, 30_000)


test("boring-ui agent dev serve listens without auto-turn and cleans up on signal", async () => {
  const workspaceRoot = await makeTempDir("boring-cli-agent-dev-serve-workspace-")
  const root = await makeAgentDir({ definitionId: "serve-agent", instructions: "SERVE_SECRET_PROMPT\n" })
  const publicDir = await makePublicDir()
  const captureFile = join(await makeTempDir("boring-cli-agent-dev-serve-capture-"), "capture.json")
  const script = await writeAgentDevSubprocessHarness(publicDir, captureFile)
  const child = spawn(process.execPath, [script], {
    cwd: cliRoot,
    env: testEnv({
      BORING_AGENT_DEV_ARGS: JSON.stringify(["agent", "dev", root, "--serve", "--allow-direct"]),
      BORING_AGENT_DEV_CAPTURE_FILE: captureFile,
      BORING_AGENT_DEV_WITH_HARNESS: "1",
      BORING_AGENT_DEV_RUNTIME_ID: "direct",
      BORING_AGENT_WORKSPACE_ROOT: workspaceRoot,
      BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml"),
      PORT: "0",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => { stdout += String(chunk) })
  child.stderr.on("data", (chunk) => { stderr += String(chunk) })
  try {
    await new Promise<void>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error(`agent dev serve did not become ready; stdout=${stdout} stderr=${stderr}`)), 10_000)
      child.stdout.on("data", () => {
        if (stdout.includes("Authored agent dev server ready.") && stdout.includes("session     dev-serve-agent")) {
          clearTimeout(timeout)
          resolveReady()
        }
      })
      child.once("exit", (code) => {
        clearTimeout(timeout)
        rejectReady(new Error(`agent dev serve exited early (${code}); stdout=${stdout} stderr=${stderr}`))
      })
    })
    expect(stdout).toContain("runtime     local")
    expect(stdout).not.toContain(root)
    expect(stdout).not.toContain(workspaceRoot)
    expect(stdout).not.toContain("SERVE_SECRET_PROMPT")
    const beforeSignal = JSON.parse(await readFile(captureFile, "utf-8")) as Record<string, unknown>
    expect(beforeSignal).toHaveProperty("factoryInput")
    expect(beforeSignal).not.toHaveProperty("promptText")
    child.kill("SIGTERM")
    child.kill("SIGINT")
    const exitCode = await new Promise<number | null>((resolveExit) => child.once("exit", resolveExit))
    expect(exitCode).toBe(0)
    const afterSignal = JSON.parse(await readFile(captureFile, "utf-8")) as { runtime?: { create?: number; dispose?: number } }
    expect(afterSignal.runtime).toMatchObject({ create: 1, dispose: 1 })
  } finally {
    if (!child.killed) child.kill("SIGTERM")
  }
}, 30_000)


test("boring-ui agent dev serve reports close failure without leaking disposal details", async () => {
  const root = await makeAgentDir({ definitionId: "close-failure-agent" })
  const publicDir = await makePublicDir()
  const captureFile = join(await makeTempDir("boring-cli-agent-dev-close-failure-capture-"), "capture.json")
  const script = await writeAgentDevSubprocessHarness(publicDir, captureFile)
  const child = spawn(process.execPath, [script], {
    cwd: cliRoot,
    env: testEnv({
      BORING_AGENT_DEV_ARGS: JSON.stringify(["agent", "dev", root, "--serve", "--allow-direct"]),
      BORING_AGENT_DEV_CAPTURE_FILE: captureFile,
      BORING_AGENT_DEV_WITH_HARNESS: "1",
      BORING_AGENT_DEV_RUNTIME_ID: "direct",
      BORING_AGENT_DEV_DISPOSE_FAIL: "1",
      BORING_AGENT_WORKSPACE_ROOT: await makeTempDir("boring-cli-agent-dev-close-failure-workspace-"),
      BORING_UI_WORKSPACES_PATH: join(await makeTempDir("boring-cli-agent-dev-registry-"), "workspaces.yaml"),
      PORT: "0",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => { stdout += String(chunk) })
  child.stderr.on("data", (chunk) => { stderr += String(chunk) })
  try {
    await new Promise<void>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error(`agent dev close-failure serve did not become ready; stdout=${stdout} stderr=${stderr}`)), 10_000)
      child.stdout.on("data", () => {
        if (stdout.includes("session     dev-close-failure-agent")) {
          clearTimeout(timeout)
          resolveReady()
        }
      })
      child.once("exit", (code) => {
        clearTimeout(timeout)
        rejectReady(new Error(`agent dev close-failure serve exited early (${code}); stdout=${stdout} stderr=${stderr}`))
      })
    })
    child.kill("SIGTERM")
    const exitCode = await new Promise<number | null>((resolveExit) => child.once("exit", resolveExit))
    expect(exitCode).toBe(1)
    expect(stderr).toContain("INTERNAL_ERROR")
    expect(stderr).not.toContain("DISPOSE_SECRET")
    const capture = JSON.parse(await readFile(captureFile, "utf-8")) as { runtime?: { dispose?: number } }
    expect(capture.runtime).toMatchObject({ dispose: 1 })
  } finally {
    if (!child.killed) child.kill("SIGTERM")
  }
}, 30_000)
