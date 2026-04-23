import { expect, test } from 'vitest'

import { createVercelSandboxWorkspace } from '../createVercelSandboxWorkspace'
import { createMockVercelSandboxHarness } from './helpers/mockVercelSandbox'

test('writes via workspace are visible to paired exec on same sandbox handle', async () => {
  const harness = await createMockVercelSandboxHarness()
  const workspace = createVercelSandboxWorkspace(harness.sandbox)

  try {
    await workspace.mkdir('shared', { recursive: true })
    await workspace.writeFile('shared/hello.txt', 'hello-from-workspace')

    const command = await harness.sandbox.runCommand('sh', [
      '-c',
      'cat /vercel/sandbox/shared/hello.txt',
    ])

    await expect(command.stdout()).resolves.toBe(
      'hello-from-workspace',
    )
    expect(command.exitCode).toBe(0)
  } finally {
    await harness.cleanup()
  }
})

test('writeFile delegates UTF-8 bytes via sandbox.writeFiles', async () => {
  const harness = await createMockVercelSandboxHarness()
  const workspace = createVercelSandboxWorkspace(harness.sandbox)

  try {
    await workspace.writeFile('utf8.txt', 'snowman ☃')

    expect(harness.lastWriteFiles).toEqual([
      {
        path: '/vercel/sandbox/utf8.txt',
        content: new Uint8Array(Buffer.from('snowman ☃', 'utf-8')),
      },
    ])
  } finally {
    await harness.cleanup()
  }
})
