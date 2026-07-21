import { execFile as execFileCallback, execFileSync } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import fastify from "fastify"
import { afterEach, beforeAll, expect, test } from "vitest"
import { registerStatic } from "../server/cli.js"

const execFile = promisify(execFileCallback)
const testDir = dirname(fileURLToPath(import.meta.url))
const cliRoot = resolve(testDir, "../..")
const distBin = join(cliRoot, "dist", "index.js")
const tempDirs: string[] = []

function hasNewerSource(root: string, artifact: string): boolean {
  if (!existsSync(artifact)) return true
  const artifactMtime = statSync(artifact).mtimeMs
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) continue
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(path)
      } else if (entry.isFile() && statSync(path).mtimeMs > artifactMtime) {
        return true
      }
    }
  }
  return false
}

beforeAll(() => {
  const agentRoot = resolve(cliRoot, "../agent")
  const pluginCliRoot = resolve(cliRoot, "../plugin-cli")
  if (hasNewerSource(join(agentRoot, "src"), join(agentRoot, "dist/server/index.js"))) {
    execFileSync("pnpm", ["--dir", agentRoot, "build"], { stdio: "pipe" })
  }
  if (hasNewerSource(join(pluginCliRoot, "src"), join(pluginCliRoot, "dist/index.js"))) {
    execFileSync("pnpm", ["--dir", pluginCliRoot, "build"], { stdio: "pipe" })
  }
  if (hasNewerSource(join(cliRoot, "src"), distBin)) {
    execFileSync("pnpm", ["--dir", cliRoot, "build"], { stdio: "pipe" })
  }
}, 90_000)

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function testEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  // Preserve the caller's environment exactly. Boring CLI subcommands should
  // simply ignore model-provider env vars; tests must not mutate/scrub them.
  return { ...process.env, ...overrides, NO_COLOR: "1" }
}

async function runCli(args: string[], env: Record<string, string>) {
  return await execFile(process.execPath, [distBin, ...args], {
    cwd: cliRoot,
    env: testEnv(env),
    timeout: 10_000,
  })
}

async function runCliFailure(args: string[], env: Record<string, string> = {}) {
  try {
    await runCli(args, env)
    throw new Error("expected command to fail")
  } catch (error) {
    if (error instanceof Error && error.message === "expected command to fail") throw error
    return error as { stdout: string; stderr: string; code: number }
  }
}

async function makeAgentDir(input: {
  definitionId?: string
  version?: string
  label?: string
  description?: string
  instructions?: string | Uint8Array
  refs?: {
    tools?: string[]
    capabilities?: string[]
    skills?: string[]
    mcpServers?: string[]
  }
} = {}): Promise<string> {
  const root = await makeTempDir("boring-cli-agent-validate-")
  const definition: Record<string, unknown> = {
    schemaVersion: 1,
    definitionId: input.definitionId ?? "reviewer-agent",
    version: input.version ?? "1.2.3",
    instructionsRef: "instructions.md",
  }
  if (input.label !== undefined) definition.label = input.label
  if (input.description !== undefined) definition.description = input.description
  if (input.refs?.tools !== undefined) definition.toolRefs = input.refs.tools
  if (input.refs?.capabilities !== undefined) definition.capabilityRequirements = input.refs.capabilities
  if (input.refs?.skills !== undefined) definition.skillRefs = input.refs.skills
  if (input.refs?.mcpServers !== undefined) definition.mcpServerRefs = input.refs.mcpServers
  await writeFile(join(root, "agent.json"), `${JSON.stringify(definition, null, 2)}\n`, "utf-8")
  await writeFile(join(root, "instructions.md"), input.instructions ?? "Follow orders.\n")
  return root
}


test("installed boring-ui --help exits without starting a workspace", async () => {
  const result = await runCli(["--help"], {})

  expect(result.stdout).toContain("Usage: boring-ui")
  expect(result.stdout).toContain("Listen host (default: 127.0.0.1)")
  expect(result.stdout).toContain("--allow-insecure-local-bridge")
  expect(result.stdout).toContain("boring-ui agent validate <dir>")
})


test("boring-ui agent validate reports a valid directory in human format without prompt or path leakage", async () => {
  const root = await makeAgentDir({
    label: "Review helper",
    description: "Reviews authored changes.",
    instructions: "Do not print this prompt.\n",
  })

  const result = await runCli(["agent", "validate", root], {})

  expect(result.stderr).toBe("")
  expect(result.stdout).toContain("Authored agent directory is valid.")
  expect(result.stdout).toContain("id: reviewer-agent")
  expect(result.stdout).toContain("version: 1.2.3")
  expect(result.stdout).toContain("label: \"Review helper\"")
  expect(result.stdout).toContain("description: \"Reviews authored changes.\"")
  expect(result.stdout).toContain(`instructions: ${new TextEncoder().encode("Do not print this prompt.\n").byteLength} bytes`)
  expect(result.stdout).not.toContain("declared refs")
  expect(result.stdout).not.toContain("tools:")
  expect(result.stdout).not.toContain("Do not print this prompt")
  expect(result.stdout).not.toContain(root)
})


test("boring-ui agent validate --json emits exact AgentValidateSuccessV1", async () => {
  const instructions = "Hello π\n"
  const root = await makeAgentDir({
    label: "JSON helper",
    description: "Validates JSON output.",
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
      description: "Validates JSON output.",
      instructions: {
        present: true,
        byteLength: new TextEncoder().encode(instructions).byteLength,
      },
    },
  })
  expect(result.stdout).not.toContain(instructions.trim())
  expect(result.stdout).not.toContain(root)
})


test.each([
  ["tools", { tools: ["shell.read"] }, "toolRefs"],
  ["capabilities", { capabilities: ["workspace-ready"] }, "capabilityRequirements"],
  ["skills", { skills: ["triage"] }, "skillRefs"],
  ["MCP servers", { mcpServers: ["linear"] }, "mcpServerRefs"],
])("boring-ui agent validate rejects non-empty legacy %s selectors", async (_label, refs, field) => {
  const root = await makeAgentDir({ refs })

  const failure = await runCliFailure(["agent", "validate", root, "--json"])

  expect(failure.code).toBe(1)
  expect(failure.stdout).toBe("")
  expect(JSON.parse(failure.stderr)).toEqual({
    schemaVersion: 1,
    ok: false,
    error: {
      code: "AUTHORED_AGENT_REFERENCE_UNSUPPORTED",
      field,
      message: `${field} cannot select behavior; configure trusted host plugins instead`,
    },
  })
  expect(failure.stderr).not.toMatch(/shell\.read|workspace-ready|triage|linear/)
})


test("boring-ui agent validate accepts empty legacy selector arrays but omits them from output", async () => {
  const root = await makeAgentDir({
    refs: { tools: [], capabilities: [], skills: [], mcpServers: [] },
  })

  const result = await runCli(["agent", "validate", root, "--json"], {})
  const payload = JSON.parse(result.stdout)

  expect(payload.ok).toBe(true)
  expect(payload.agent).not.toHaveProperty("refs")
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


test.each([false, true])(
  "boring-ui agent validate redacts an unclassified internal failure (json=%s)",
  async (json) => {
    const trigger = "Trigger only the command-path encoder.\n"
    const root = await makeAgentDir({ instructions: trigger })
    const preloadRoot = await makeTempDir("boring-cli-agent-internal-error-")
    const preload = join(preloadRoot, "throwing-text-encoder.mjs")
    await writeFile(
      preload,
      `const NativeTextEncoder = globalThis.TextEncoder\n` +
        `globalThis.TextEncoder = class extends NativeTextEncoder { encode(value) {\n` +
        `  if (value === ${JSON.stringify(trigger)}) throw new Error("ESECRET /private/encoder.ts")\n` +
        `  return super.encode(value)\n` +
        `} }\n`,
      "utf-8",
    )

    const failure = await runCliFailure(
      ["agent", "validate", root, ...(json ? ["--json"] : [])],
      { NODE_OPTIONS: `--import=${preload}` },
    )

    expect(failure.code).toBe(1)
    expect(failure.stdout).toBe("")
    if (json) {
      expect(JSON.parse(failure.stderr)).toEqual({
        schemaVersion: 1,
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "agent validation failed",
        },
      })
    } else {
      expect(failure.stderr).toBe('INTERNAL_ERROR: "agent validation failed"\n')
    }
    expect(failure.stderr).not.toMatch(/ESECRET|private|encoder/)
    expect(failure.stderr).not.toContain(root)
  },
)


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
      message: "instructionsRef must not be a symbolic link",
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


test("boring-ui agent validate human output escapes spoofing controls in version metadata", async () => {
  const root = await makeAgentDir({
    version: "1.0.0\u202espoof\u202c\u0085",
    label: "Safe label",
  })

  const result = await runCli(["agent", "validate", root], {})

  expect(result.stderr).toBe("")
  expect(result.stdout).toContain("1.0.0\\u202espoof\\u202c\\u0085")
  expect(result.stdout).toContain('label: "Safe label"')
  expect(result.stdout).not.toContain("\u202espoof")
  expect(result.stdout).not.toContain("\u0085")
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


test("boring-ui refuses non-loopback host without explicit insecure bridge opt-in", async () => {
  await expect(runCli(["--host", "0.0.0.0"], {})).rejects.toMatchObject({
    stderr: expect.stringContaining("--allow-insecure-local-bridge"),
  })
})

test("boring-ui plugin reuses plugin CLI install/list/remove handlers", async () => {
  const root = await makeTempDir("boring-cli-plugin-facade-")
  const workspaceRoot = join(root, "workspace")
  const pluginRoot = join(root, "facade-plugin")
  await mkdir(join(pluginRoot, "front"), { recursive: true })
  await mkdir(workspaceRoot, { recursive: true })
  await writeFile(join(pluginRoot, "front", "index.tsx"), "export default function Plugin() { return null }\n", "utf-8")
  await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
    name: "facade-plugin",
    version: "1.0.0",
    boring: { front: "front/index.tsx" },
  }), "utf-8")

  const install = await runCli(["plugin", "install", pluginRoot, "--workspace", workspaceRoot], {})
  expect(install.stdout).toContain("installed facade-plugin")
  expect(install.stdout).toContain("scope local")

  const list = await runCli(["plugin", "list", "--json", "--workspace", workspaceRoot], {})
  expect(JSON.parse(list.stdout).records).toEqual([expect.objectContaining({ id: "facade-plugin", scope: "local" })])

  await expect(runCli(["plugin", "remove", "facade-plugin", "--workspace", workspaceRoot], {})).resolves.toMatchObject({
    stdout: expect.stringContaining("removed facade-plugin"),
  })
}, 20_000)

test("package exposes an installable boring-ui bin with published assets", async () => {
  const packageJson = JSON.parse(await readFile(join(cliRoot, "package.json"), "utf-8")) as {
    bin?: Record<string, string>
    files?: string[]
    dependencies?: Record<string, string>
  }

  expect(packageJson.bin?.["boring-ui"]).toBe("./dist/index.js")
  expect(packageJson.files).toEqual(expect.arrayContaining(["dist/", "public/"]))
  expect(packageJson.dependencies).toEqual(expect.objectContaining({
    "@fastify/static": expect.any(String),
    "@hachej/boring-agent": expect.any(String),
    "@hachej/boring-ask-user": expect.any(String),
    "@hachej/boring-workspace": expect.any(String),
    fastify: expect.any(String),
  }))

  const builtBin = await readFile(distBin, "utf-8")
  expect(builtBin.startsWith("#!/usr/bin/env node")).toBe(true)

  const builtCli = await readFile(join(cliRoot, "dist", "server", "cli.js"), "utf-8")
  expect(builtCli).not.toMatch(/from ["']@mariozechner\/pi-coding-agent["']/)
  expect(builtCli).not.toMatch(/from ["']@hachej\/boring-agent\/(server|shared)["']/)
})

test("installed CLI workspace subcommands use an isolated registry", { timeout: 30_000 }, async () => {
  const root = await makeTempDir("boring-cli-install-root-")
  const project = await makeTempDir("boring-cli-install-project-")
  const registryPath = join(root, "workspaces.yaml")
  const env = { BORING_UI_WORKSPACES_PATH: registryPath }

  await expect(runCli(["workspaces", "list"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining("No workspaces"),
  })

  const addResult = await runCli(["workspaces", "add", project], env)
  expect(addResult.stdout).toContain(project)
  const id = addResult.stdout.match(/id\s+(\S+)/)?.[1]
  if (!id) throw new Error(`missing workspace id in output: ${addResult.stdout}`)

  await expect(runCli(["workspaces", "list"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining(id),
  })

  await expect(runCli(["workspaces", "rename", id, "Renamed", "Project"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining("Renamed Project"),
  })
  await expect(runCli(["workspaces", "list"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining("Renamed Project"),
  })

  await expect(runCli(["workspaces", "remove", id], env)).resolves.toMatchObject({
    stdout: expect.stringContaining(`removed ${id}`),
  })
  await expect(runCli(["workspaces", "list"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining("No workspaces"),
  })
})

test("installed CLI serves built assets with browser-safe MIME types", async () => {
  const publicDir = await makeTempDir("boring-cli-static-public-")
  await mkdir(join(publicDir, "assets"))
  await writeFile(
    join(publicDir, "index.html"),
    '<!doctype html><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">',
    "utf-8",
  )
  await writeFile(join(publicDir, "assets", "app.js"), "console.log('ok')", "utf-8")
  await writeFile(join(publicDir, "assets", "app.css"), "body { color: black; }", "utf-8")

  const app = fastify({ logger: false })
  await registerStatic(app, publicDir)
  try {
    const script = await app.inject({ method: "GET", url: "/assets/app.js" })
    const stylesheet = await app.inject({ method: "GET", url: "/assets/app.css" })
    const fallback = await app.inject({ method: "GET", url: "/workspace/deep-link" })

    expect(script.statusCode).toBe(200)
    expect(script.headers["content-type"]).toContain("application/javascript")
    expect(stylesheet.statusCode).toBe(200)
    expect(stylesheet.headers["content-type"]).toContain("text/css")
    expect(fallback.statusCode).toBe(200)
    expect(fallback.headers["content-type"]).toContain("text/html")
  } finally {
    await app.close()
  }
}, 20_000)

test("installed boring-ui help does not expose plugin authoring commands", async () => {
  const result = await runCli(["--help"], {})

  expect(result.stdout).toContain("Usage: boring-ui")
  expect(result.stdout).not.toContain("plugin-status")
  expect(result.stdout).not.toContain("scaffold-plugin")
  expect(result.stdout).not.toContain("verify-plugin")
  expect(result.stdout).not.toContain("test-plugin")
  expect(result.stdout).not.toContain("plugin create")
})

test("installed CLI rejects file paths as local workspaces", async () => {
  const root = await makeTempDir("boring-cli-install-root-")
  const fileDir = await makeTempDir("boring-cli-install-file-")
  const file = join(fileDir, "not-a-workspace.txt")
  await writeFile(file, "not a directory", "utf-8")
  const env = { BORING_UI_WORKSPACES_PATH: join(root, "workspaces.yaml") }

  await expect(runCli(["workspaces", "add", file], env)).rejects.toMatchObject({
    stderr: expect.stringContaining("workspace path is not a directory"),
  })
  await expect(runCli(["workspaces", "list"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining("No workspaces"),
  })
}, 20_000)
