import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"

import { createWorkspacesModeApp } from "../server/cli.js"
import { createLocalWorkspaceRegistry } from "../server/localWorkspaces.js"

const tempDirs: string[] = []
const originalHome = process.env.HOME

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

// Sol round-2 (drift from finding 12): createWorkspaceAgentServer.ts's own
// rebuildPackageResourceRegistry only enumerates ~/.pi/agent/skills when
// ambient skills are explicitly enabled (`opts.pi?.noSkills === false`).
// CLI workspaces mode's own syncLoadedPluginPiSnapshot re-implements that
// enumeration and used to run it unconditionally, so `loadAmbientSkills:
// false` silently failed to suppress the user's global ~/.pi/agent/skills
// directory from managedSkills — inconsistent with standalone folder mode.
describe("createWorkspacesModeApp ambient skill gating", () => {
  test("loadAmbientSkills: false excludes ~/.pi/agent/skills from managed skills", async () => {
    const homeRoot = await makeTempDir("boring-cli-ambient-skills-home-")
    const workspaceRoot = await makeTempDir("boring-cli-ambient-skills-workspace-")
    const registryPath = join(await makeTempDir("boring-cli-ambient-skills-registry-"), "workspaces.yaml")
    process.env.HOME = homeRoot

    await mkdir(join(homeRoot, ".pi", "agent", "skills", "global-skill"), { recursive: true })
    await writeFile(
      join(homeRoot, ".pi", "agent", "skills", "global-skill", "SKILL.md"),
      "---\nname: global-skill\ndescription: Ambient global skill.\n---\n# Global\n",
      "utf8",
    )

    const registry = createLocalWorkspaceRegistry(registryPath)
    const workspace = await registry.add(workspaceRoot)

    const app = await createWorkspacesModeApp({
      mode: "direct",
      registryPath,
      provisionWorkspace: false,
      loadAmbientSkills: false,
    })

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/agents/default/skills",
        headers: { "x-boring-workspace-id": workspace.id },
      })
      expect(response.statusCode).toBe(200)
      const { skills } = response.json() as { skills: Array<{ name: string }> }
      expect(skills.map((skill) => skill.name)).not.toContain("global-skill")
    } finally {
      await app.close()
    }
  }, 20_000)

  test("loadAmbientSkills left on (default) includes ~/.pi/agent/skills in managed skills", async () => {
    const homeRoot = await makeTempDir("boring-cli-ambient-skills-home-on-")
    const workspaceRoot = await makeTempDir("boring-cli-ambient-skills-workspace-on-")
    const registryPath = join(await makeTempDir("boring-cli-ambient-skills-registry-on-"), "workspaces.yaml")
    process.env.HOME = homeRoot

    await mkdir(join(homeRoot, ".pi", "agent", "skills", "global-skill"), { recursive: true })
    await writeFile(
      join(homeRoot, ".pi", "agent", "skills", "global-skill", "SKILL.md"),
      "---\nname: global-skill\ndescription: Ambient global skill.\n---\n# Global\n",
      "utf8",
    )

    const registry = createLocalWorkspaceRegistry(registryPath)
    const workspace = await registry.add(workspaceRoot)

    const app = await createWorkspacesModeApp({
      mode: "direct",
      registryPath,
      provisionWorkspace: false,
    })

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/agents/default/skills",
        headers: { "x-boring-workspace-id": workspace.id },
      })
      expect(response.statusCode).toBe(200)
      const { skills } = response.json() as { skills: Array<{ name: string }> }
      expect(skills.map((skill) => skill.name)).toContain("global-skill")
    } finally {
      await app.close()
    }
  }, 20_000)
})
