import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
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

  // gh-1196: ~/.pi/agent/skills is normally a tree of symlinks into other
  // roots, so a single entry the host cannot admit is routine — here a link
  // that resolves to a file that is not named SKILL.md. That one entry used to
  // fail the whole shared-skill scan closed and 500 every agent-scoped route.
  // It must degrade to a diagnostic — never be followed, never take the
  // registry down, and never suppress the skills that are admissible.
  test("an unadmittable ~/.pi/agent/skills symlink degrades without breaking agent routes", async () => {
    const homeRoot = await makeTempDir("boring-cli-ambient-skills-home-badlink-")
    const workspaceRoot = await makeTempDir("boring-cli-ambient-skills-workspace-badlink-")
    const registryPath = join(await makeTempDir("boring-cli-ambient-skills-registry-badlink-"), "workspaces.yaml")
    process.env.HOME = homeRoot

    const skillsRoot = join(homeRoot, ".pi", "agent", "skills")
    await mkdir(join(skillsRoot, "global-skill"), { recursive: true })
    await writeFile(
      join(skillsRoot, "global-skill", "SKILL.md"),
      "---\nname: global-skill\ndescription: Ambient global skill.\n---\n# Global\n",
      "utf8",
    )
    // A skill entry whose SKILL.md links out to a differently named file.
    await mkdir(join(homeRoot, "notes"), { recursive: true })
    await writeFile(
      join(homeRoot, "notes", "aliased-skill.md"),
      "---\nname: aliased-skill\ndescription: Linked out of the skills tree.\n---\n",
      "utf8",
    )
    await mkdir(join(skillsRoot, "aliased-skill"), { recursive: true })
    await symlink(
      join(homeRoot, "notes", "aliased-skill.md"),
      join(skillsRoot, "aliased-skill", "SKILL.md"),
    )

    const registry = createLocalWorkspaceRegistry(registryPath)
    const workspace = await registry.add(workspaceRoot)

    const app = await createWorkspacesModeApp({
      mode: "direct",
      registryPath,
      provisionWorkspace: false,
    })

    try {
      const skillsResponse = await app.inject({
        method: "GET",
        url: "/api/v1/agents/default/skills",
        headers: { "x-boring-workspace-id": workspace.id },
      })
      expect(skillsResponse.statusCode).toBe(200)
      const { skills } = skillsResponse.json() as { skills: Array<{ name: string }> }
      // The admissible ambient skills still load. (Pi's own ambient loader
      // still surfaces the aliased entry from the user's own HOME; what
      // changed is that it no longer takes every agent-scoped route down.)
      expect(skills.map((skill) => skill.name)).toContain("global-skill")

      const describeResponse = await app.inject({
        method: "GET",
        url: "/api/v1/agents/default/describe",
        headers: { "x-boring-workspace-id": workspace.id },
      })
      expect(describeResponse.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  }, 20_000)
})
