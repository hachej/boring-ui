import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSkills } from '@mariozechner/pi-coding-agent'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function skill(root: string, description: string): Promise<string> {
  const directory = join(root, 'same-name')
  const file = join(directory, 'SKILL.md')
  await mkdir(directory, { recursive: true })
  await writeFile(file, `---\nname: same-name\ndescription: ${description}\n---\n`, 'utf8')
  return file
}

describe('pinned Pi skill discovery', () => {
  test('keeps the first same-name root and accepts directory or SKILL.md inputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boring-pi-skills-'))
    roots.push(root)
    const firstRoot = join(root, 'first')
    const secondRoot = join(root, 'second')
    const firstFile = await skill(firstRoot, 'First winner.')
    const secondFile = await skill(secondRoot, 'Second loser.')
    const options = { cwd: root, agentDir: join(root, 'agent'), includeDefaults: false }

    const result = loadSkills({ ...options, skillPaths: [firstRoot, secondRoot] })
    expect(result.skills).toEqual([
      expect.objectContaining({ name: 'same-name', description: 'First winner.', filePath: firstFile }),
    ])
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        type: 'collision',
        collision: expect.objectContaining({ winnerPath: firstFile, loserPath: secondFile }),
      }),
    ])
    expect(loadSkills({ ...options, skillPaths: [firstFile] }).skills[0]).toMatchObject({
      filePath: firstFile,
      baseDir: join(firstRoot, 'same-name'),
    })
  })
})
