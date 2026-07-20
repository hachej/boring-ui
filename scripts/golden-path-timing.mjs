#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { performance } from "node:perf_hooks"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
const outputPath = resolve(repoRoot, "docs/issues/391/runtime-refactor/golden-path.json")
const compositionDigest = `sha256:${"a".repeat(64)}`
const stagesCovered = [
  "A1 compileAgentDirectory (#624)",
  "P6-R resolveAgentDeployment (#647)",
]
const stagesPending = [
  "persisted workspace-type package tracer",
  "Seneca two-domain agent-product deployment proof",
]

function seconds(startMs, endMs) {
  return Number(((endMs - startMs) / 1000).toFixed(6))
}

async function readRootVersion() {
  const rootPackage = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8"))
  if (typeof rootPackage.version !== "string" || rootPackage.version.length === 0) {
    throw new Error("root package.json must declare version for golden-path timing")
  }
  return rootPackage.version
}

async function loadAgentDefinitionApi() {
  const compiler = await import(pathToFileURL(resolve(
    repoRoot,
    "packages/agent/src/server/agentDefinition/compileAgentDirectory.ts",
  )).href)
  const resolver = await import(pathToFileURL(resolve(
    repoRoot,
    "packages/agent/src/server/agentDefinition/resolveAgentDeployment.ts",
  )).href)
  return {
    compileAgentDirectory: compiler.compileAgentDirectory,
    resolveAgentDeployment: resolver.resolveAgentDeployment,
  }
}

async function createSampleAgentDirectory() {
  const directory = await mkdtemp(resolve(tmpdir(), "boring-golden-path-"))
  try {
    await writeFile(resolve(directory, "agent.json"), `${JSON.stringify({
      schemaVersion: 1,
      definitionId: "golden-path",
      version: "1.0.0",
      label: "Golden path timing fixture",
      description: "Measures declarative agent compilation and resolution.",
      instructionsRef: "instructions.md",
    }, null, 2)}\n`, "utf8")
    await writeFile(
      resolve(directory, "instructions.md"),
      "You are the checked-in fixture agent for the #391 P8 golden-path timing slice.\n" +
        "Keep responses short and inspect the authorized workspace context before making\n" +
        "changes.\n",
      "utf8",
    )
    return directory
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function main() {
  const version = await readRootVersion()
  const {
    compileAgentDirectory,
    resolveAgentDeployment,
  } = await loadAgentDefinitionApi()
  const sampleAgentDir = await createSampleAgentDirectory()

  try {
    const totalStart = performance.now()
    const compileStart = performance.now()
    const bundle = await compileAgentDirectory(sampleAgentDir)
    const compileEnd = performance.now()

    const fixtureDeployment = {
      deploymentId: "golden-path-eu",
      version,
      agentId: "default",
      definition: {
        definitionId: bundle.definition.definitionId,
        version: bundle.definition.version,
        digest: bundle.definitionDigest,
      },
    }
    const fixtureBinding = {
      workspaceId: "golden-path-workspace",
      defaultDeploymentId: fixtureDeployment.deploymentId,
      workspaceCompositionDigest: compositionDigest,
    }

    const resolveStart = performance.now()
    await resolveAgentDeployment(bundle, fixtureDeployment, fixtureBinding)
    const resolveEnd = performance.now()
    const totalEnd = performance.now()

    const payload = {
      version,
      date: new Date().toISOString(),
      seconds: {
        compileAgentDirectory: seconds(compileStart, compileEnd),
        resolveAgentDeployment: seconds(resolveStart, resolveEnd),
        total: seconds(totalStart, totalEnd),
      },
      stagesCovered,
      stagesPending,
    }

    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    console.log(`wrote ${outputPath}`)
    console.log(JSON.stringify(payload.seconds))
  } finally {
    await rm(sampleAgentDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
