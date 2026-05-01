import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { provisionRuntimeWorkspace } from '../src/server/workspace/provisionRuntime'

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(here, '..')
const fixtureRoot = path.join(packageRoot, 'fixtures', 'provisioning')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main(): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'boring-agent-provisioning-eval-'))
  try {
    const first = await provisionRuntimeWorkspace({
      workspaceRoot,
      contributions: [
        {
          id: 'test-sdk',
          provisioning: {
            templateDirs: [
              {
                id: 'test-template',
                path: path.join(fixtureRoot, 'template'),
              },
            ],
            python: [
              {
                id: 'test-python-sdk',
                projectFile: path.join(fixtureRoot, 'test-sdk', 'pyproject.toml'),
                env: {
                  BORING_PROVISION_TEST_ENV: 'from-agent-provisioner',
                },
              },
            ],
          },
        },
      ],
    })

    assert(first.changed, 'first provisioning run should report changed=true')
    assert(first.fingerprint.startsWith('sha256:'), 'fingerprint should be sha256-prefixed')

    const skill = await readFile(
      path.join(workspaceRoot, '.agents', 'skills', 'test-sdk', 'SKILL.md'),
      'utf8',
    )
    assert(skill.includes('Test SDK Skill'), 'template skill was not copied')

    const cliPath = path.join(workspaceRoot, '.boring-agent', 'bin', 'boring-provision-test')
    const { stdout } = await execFileAsync(cliPath, ['alpha', 'beta'], {
      maxBuffer: 1024 * 1024,
    })
    const payload = JSON.parse(stdout) as {
      ok?: boolean
      workspace?: string
      customEnv?: string
      args?: string[]
      templateFileExists?: boolean
    }

    assert(payload.ok === true, 'fixture CLI did not report ok=true')
    assert(payload.workspace === workspaceRoot, 'fixture CLI did not receive BORING_AGENT_WORKSPACE_ROOT')
    assert(payload.customEnv === 'from-agent-provisioner', 'fixture CLI did not receive custom env')
    assert(payload.templateFileExists === true, 'fixture CLI could not see copied template file')
    assert(JSON.stringify(payload.args) === JSON.stringify(['alpha', 'beta']), 'fixture CLI args mismatch')

    await execFileAsync(path.join(workspaceRoot, '.boring-agent', 'bin', 'python'), [
      '-c',
      'import test_agent_sdk; print("import-ok")',
    ])

    const second = await provisionRuntimeWorkspace({
      workspaceRoot,
      contributions: [
        {
          id: 'test-sdk',
          provisioning: {
            templateDirs: [{ id: 'test-template', path: path.join(fixtureRoot, 'template') }],
            python: [{
              id: 'test-python-sdk',
              projectFile: path.join(fixtureRoot, 'test-sdk', 'pyproject.toml'),
              env: { BORING_PROVISION_TEST_ENV: 'from-agent-provisioner' },
            }],
          },
        },
      ],
    })
    assert(second.changed === false, 'second provisioning run should hit marker and report changed=false')
    assert(second.fingerprint === first.fingerprint, 'fingerprint changed across identical runs')

    console.log(JSON.stringify({
      ok: true,
      workspaceRoot,
      fingerprint: first.fingerprint,
      binDir: first.binDir,
      cli: payload,
    }, null, 2))
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
