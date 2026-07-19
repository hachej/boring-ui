import { symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "vitest"
import { makeAgentDir, makeTempDir, runCli, runCliFailure } from "./agentCommandsTestSupport.js"

test("installed boring-ui --help exits without starting a workspace", async () => {
  const result = await runCli(["--help"], {})

  expect(result.stdout).toContain("Usage: boring-ui")
  expect(result.stdout).toContain("Listen host (default: 127.0.0.1)")
  expect(result.stdout).toContain("--allow-insecure-local-bridge")
  expect(result.stdout).toContain("boring-ui agent validate <dir>")
  expect(result.stdout).toContain("boring-ui agent dev <dir>")
})


test("boring-ui agent validate reports a valid directory in human format without prompt or path leakage", async () => {
  const root = await makeAgentDir({
    label: "Review helper",
    instructions: "Do not print this prompt.\n",
  })

  const result = await runCli(["agent", "validate", root], {})

  expect(result.stderr).toBe("")
  expect(result.stdout).toContain("Authored agent directory is valid.")
  expect(result.stdout).toContain("id: reviewer-agent")
  expect(result.stdout).toContain("version: 1.2.3")
  expect(result.stdout).toContain("label: \"Review helper\"")
  expect(result.stdout).toContain(`instructions: ${new TextEncoder().encode("Do not print this prompt.\n").byteLength} bytes`)
  expect(result.stdout).toContain("tools: 0")
  expect(result.stdout).not.toContain("Do not print this prompt")
  expect(result.stdout).not.toContain(root)
})


test("boring-ui agent validate --json emits exact AgentValidateSuccessV1", async () => {
  const instructions = "Hello π\n"
  const root = await makeAgentDir({
    label: "JSON helper",
    instructions,
  })

  const result = await runCli(["agent", "validate", root, "--json"], {})

  expect(result.stderr).toBe("")
  expect(JSON.parse(result.stdout)).toEqual({
    schemaVersion: 1,
    ok: true,
    agent: {
      agentTypeId: "reviewer-agent",
      version: "1.2.3",
      label: "JSON helper",
      instructions: {
        present: true,
        byteLength: new TextEncoder().encode(instructions).byteLength,
      },
      refs: {
        tools: [],
        capabilities: [],
        skills: [],
        mcpServers: [],
      },
    },
  })
  expect(result.stdout).not.toContain(instructions.trim())
  expect(result.stdout).not.toContain(root)
})


test("boring-ui agent validate reports declared refs without catalog resolution claims", { timeout: 20_000 }, async () => {
  const root = await makeAgentDir({
    refs: {
      tools: ["shell.read", "issue.lookup"],
      capabilities: ["workspace-ready"],
      skills: ["triage"],
      mcpServers: ["linear"],
    },
  })

  const human = await runCli(["agent", "validate", root], {})
  expect(human.stdout).toContain("tools: 2 (shell.read, issue.lookup)")
  expect(human.stdout).toContain("capabilities: 1 (workspace-ready)")
  expect(human.stdout).toContain("skills: 1 (triage)")
  expect(human.stdout).toContain("mcpServers: 1 (linear)")
  expect(human.stdout).not.toMatch(/resolved|materialized|catalog|runtime/i)

  const json = await runCli(["agent", "validate", root, "--json"], {})
  expect(JSON.parse(json.stdout).agent.refs).toEqual({
    tools: ["shell.read", "issue.lookup"],
    capabilities: ["workspace-ready"],
    skills: ["triage"],
    mcpServers: ["linear"],
  })
})


test("boring-ui agent validate --json emits exact AgentCliErrorV1 and exit for malformed JSON", async () => {
  const root = await makeTempDir("boring-cli-agent-malformed-")
  await writeFile(join(root, "agent.json"), "{ definitely not json", "utf-8")
  await writeFile(join(root, "instructions.md"), "Secret prompt.\n", "utf-8")

  const failure = await runCliFailure(["agent", "validate", root, "--json"])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "AGENT_MANIFEST_INVALID_JSON",
      field: "agent.json",
      message: "agent.json must contain valid JSON",
    },
  })
  expect(failure.stderr).not.toContain(root)
  expect(failure.stderr).not.toContain("Secret prompt")
})


test("boring-ui agent validate reports schema failures with stable code and field", async () => {
  const root = await makeTempDir("boring-cli-agent-schema-")
  await writeFile(join(root, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "schema-agent",
    version: "1.0.0",
    instructionsRef: "instructions.md",
    deploymentId: "not-allowed",
  }), "utf-8")
  await writeFile(join(root, "instructions.md"), "Schema prompt.\n", "utf-8")

  const failure = await runCliFailure(["agent", "validate", root, "--json"])

  expect(failure.code).toBe(1)
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "AGENT_DEFINITION_UNSUPPORTED_FIELD",
      field: "deploymentId",
      message: "deploymentId is not supported by schema version 1",
    },
  })
})


test("boring-ui agent validate reports missing inputs with stable compiler code and field", async () => {
  const root = await makeTempDir("boring-cli-agent-missing-")
  await writeFile(join(root, "instructions.md"), "Missing manifest prompt.\n", "utf-8")

  const failure = await runCliFailure(["agent", "validate", root, "--json"])

  expect(failure.code).toBe(1)
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "AGENT_MANIFEST_NOT_FOUND",
      field: "agent.json",
      message: "agent.json does not exist",
    },
  })
  expect(failure.stderr).not.toContain(root)
})


test("boring-ui agent validate rejects traversal instructions refs without leaking paths", async () => {
  const root = await makeTempDir("boring-cli-agent-traversal-")
  await writeFile(join(root, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "traversal-agent",
    version: "1.0.0",
    instructionsRef: "../instructions.md",
  }), "utf-8")

  const failure = await runCliFailure(["agent", "validate", root, "--json"])

  expect(failure.code).toBe(1)
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "AGENT_DEFINITION_INVALID",
      field: "instructionsRef",
      message: "instructionsRef must be a safe relative asset path",
    },
  })
  expect(failure.stderr).not.toContain(root)
})


test("boring-ui agent validate rejects symlink escapes with stable compiler code and field", async () => {
  const root = await makeTempDir("boring-cli-agent-symlink-")
  const outside = await makeTempDir("boring-cli-agent-symlink-outside-")
  await writeFile(join(root, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "symlink-agent",
    version: "1.0.0",
    instructionsRef: "instructions.md",
  }), "utf-8")
  await writeFile(join(outside, "instructions.md"), "Outside prompt.\n", "utf-8")
  await symlink(join(outside, "instructions.md"), join(root, "instructions.md"))

  const failure = await runCliFailure(["agent", "validate", root, "--json"])

  expect(failure.code).toBe(1)
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "AGENT_PATH_SYMLINK_ESCAPE",
      field: "instructionsRef",
      message: "instructionsRef resolves outside the agent directory",
    },
  })
  expect(failure.stderr).not.toContain(root)
  expect(failure.stderr).not.toContain(outside)
  expect(failure.stderr).not.toContain("Outside prompt")
})


test("boring-ui agent validate rejects invalid UTF-8 with stable compiler code and field", async () => {
  const root = await makeTempDir("boring-cli-agent-utf8-")
  await writeFile(join(root, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "utf8-agent",
    version: "1.0.0",
    instructionsRef: "instructions.md",
  }), "utf-8")
  await writeFile(join(root, "instructions.md"), new Uint8Array([0xc3, 0x28]))

  const failure = await runCliFailure(["agent", "validate", root, "--json"])

  expect(failure.code).toBe(1)
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "AGENT_ASSET_INVALID_UTF8",
      field: "instructionsRef",
      message: "instructionsRef must contain valid UTF-8",
    },
  })
  expect(failure.stderr).not.toContain(root)
})


test("boring-ui agent validate rejects invalid product agent IDs with stable materializer code", async () => {
  const root = await makeAgentDir({ definitionId: "Invalid_ID" })

  const failure = await runCliFailure(["agent", "validate", root, "--json"])

  expect(failure.code).toBe(1)
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "AUTHORED_AGENT_ID_INVALID",
      field: "definitionId",
      message: "definitionId must match ^[a-z][a-z0-9-]{0,62}$",
    },
  })
  expect(failure.stderr).not.toContain(root)
})


test("boring-ui agent validate --json ignores unrelated server mode configuration", async () => {
  const root = await makeAgentDir()

  const result = await runCli(["agent", "validate", root, "--json"], { BORING_MODE: "definitely-invalid" })

  expect(result.stderr).toBe("")
  expect(JSON.parse(result.stdout)).toMatchObject({
    schemaVersion: 1,
    ok: true,
    agent: { agentTypeId: "reviewer-agent" },
  })
})


test("boring-ui agent validate accepts exact --json before the agent command", async () => {
  const root = await makeAgentDir()

  const result = await runCli(["--json", "agent", "validate", root], {})

  expect(result.stderr).toBe("")
  expect(JSON.parse(result.stdout)).toMatchObject({
    schemaVersion: 1,
    ok: true,
    agent: { agentTypeId: "reviewer-agent" },
  })
})


test("boring-ui agent validate accepts exact --json between agent and validate", async () => {
  const root = await makeAgentDir()

  const result = await runCli(["agent", "--json", "validate", root], {})

  expect(result.stderr).toBe("")
  expect(JSON.parse(result.stdout)).toMatchObject({
    schemaVersion: 1,
    ok: true,
    agent: { agentTypeId: "reviewer-agent" },
  })
})


test("boring-ui options before bare agent fail safely without starting non-loopback folder mode", async () => {
  const failure = await runCliFailure(["--host", "0.0.0.0", "agent"])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(failure.stderr).toContain("CONFIG_INVALID")
  expect(failure.stderr).toContain('"--host"')
  expect(failure.stderr).not.toContain("starting http://")
  expect(failure.stderr).not.toContain("--allow-insecure-local-bridge")
})


test("boring-ui agent validate rejects extra positionals instead of validating the wrong directory", async () => {
  const root = await makeAgentDir()

  const failure = await runCliFailure(["agent", "validate", root, "extra", "--json"])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "CONFIG_INVALID",
      field: "arguments",
      message: "usage: boring-ui agent validate <dir>",
    },
  })
})


test("boring-ui agent validate rejects unsupported options with JSON error envelope", async () => {
  const root = await makeAgentDir()

  const failure = await runCliFailure(["agent", "validate", root, "--jsoon", "--json"])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "CONFIG_INVALID",
      field: "--jsoon",
      message: "usage: boring-ui agent validate <dir> [--json]",
    },
  })
})


test("boring-ui agent validate exact --json selects JSON even after an unsupported valued-looking option", async () => {
  const root = await makeAgentDir()

  const failure = await runCliFailure(["agent", "validate", root, "--port", "--json"])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "CONFIG_INVALID",
      field: "--port",
      message: "usage: boring-ui agent validate <dir> [--json]",
    },
  })
})


test("boring-ui agent validate exact --json selects JSON before an unsupported option", async () => {
  const root = await makeAgentDir()

  const failure = await runCliFailure(["agent", "validate", root, "--json", "--port"])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "CONFIG_INVALID",
      field: "--port",
      message: "usage: boring-ui agent validate <dir> [--json]",
    },
  })
})


test("boring-ui agent validate rejects valued --json syntax as human output unless exact --json is present", async () => {
  const root = await makeAgentDir()

  const failure = await runCliFailure(["agent", "validate", root, "--json=false"])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(failure.stderr).toContain("CONFIG_INVALID")
  expect(failure.stderr).toContain('"--json"')
  expect(failure.stderr).toContain('"usage: boring-ui agent validate <dir> [--json]"')
})


test("boring-ui agent validate human output escapes spoofing controls in manifest-controlled fields", async () => {
  const root = await makeAgentDir({
    version: "1.0.0\u202espoof\u202c\u0085",
    label: "Label\u2028Next\u2066spoof\u2069",
    refs: {
      tools: ["tool\u202eexe", "line\u2029break", "c1\u009bref"],
      capabilities: ["cap\u200fref"],
      skills: ["skill\u061cref"],
      mcpServers: ["mcp\u2066ref\u2069"],
    },
  })

  const result = await runCli(["agent", "validate", root], {})

  expect(result.stderr).toBe("")
  expect(result.stdout).toContain("1.0.0\\u202espoof\\u202c\\u0085")
  expect(result.stdout).toContain("Label\\u2028Next\\u2066spoof\\u2069")
  expect(result.stdout).toContain("tool\\u202eexe")
  expect(result.stdout).toContain("line\\u2029break")
  expect(result.stdout).toContain("c1\\u009bref")
  expect(result.stdout).toContain("cap\\u200fref")
  expect(result.stdout).toContain("skill\\u061cref")
  expect(result.stdout).toContain("mcp\\u2066ref\\u2069")
  expect(result.stdout).not.toContain("\u202espoof")
  expect(result.stdout).not.toContain("\u2028Next")
  expect(result.stdout).not.toContain("\u009bref")
})


test("boring-ui agent validate human errors escape manifest-controlled fields", async () => {
  const root = await makeTempDir("boring-cli-agent-human-redaction-")
  const unsafeKey = "bad\u001b]52;c;boom\u0007"
  await writeFile(join(root, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "escape-agent",
    version: "1.0.0",
    instructionsRef: "instructions.md",
    [unsafeKey]: true,
  }), "utf-8")
  await writeFile(join(root, "instructions.md"), "Prompt stays hidden.\n", "utf-8")

  const failure = await runCliFailure(["agent", "validate", root])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(failure.stderr).toContain("AGENT_DEFINITION_UNSUPPORTED_FIELD")
  expect(failure.stderr).toContain("\\u001b]52;c;boom\\u0007")
  expect(failure.stderr).not.toContain("\u001b]52;c;boom\u0007")
  expect(failure.stderr).not.toContain("Prompt stays hidden")
  expect(failure.stderr).not.toContain(root)
})


test("boring-ui agent validate human errors escape bidi and C1 controls in fields and messages", async () => {
  const root = await makeTempDir("boring-cli-agent-human-bidi-redaction-")
  const unsafeKey = "bad\u202espoof\u202c\u0085"
  await writeFile(join(root, "agent.json"), JSON.stringify({
    schemaVersion: 1,
    definitionId: "escape-agent",
    version: "1.0.0",
    instructionsRef: "instructions.md",
    [unsafeKey]: true,
  }), "utf-8")
  await writeFile(join(root, "instructions.md"), "Prompt stays hidden.\n", "utf-8")

  const failure = await runCliFailure(["agent", "validate", root])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(failure.stderr).toContain("bad\\u202espoof\\u202c\\u0085")
  expect(failure.stderr).not.toContain("bad\u202espoof")
  expect(failure.stderr).not.toContain("\u0085")
  expect(failure.stderr).not.toContain("Prompt stays hidden")
  expect(failure.stderr).not.toContain(root)
})
