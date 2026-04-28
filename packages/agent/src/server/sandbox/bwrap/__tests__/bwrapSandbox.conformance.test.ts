import { spawnSync } from 'node:child_process'

import { sandboxConformance } from '../../../../__tests__/conformance/sandbox'
import { createTempWorkspace } from '../../../../__tests__/helpers'
import { createBwrapSandbox } from '../createBwrapSandbox'

const HAS_BWRAP = (() => {
  const result = spawnSync('bwrap', ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
})()

sandboxConformance(
  'bwrap-sandbox',
  async () => {
    const temp = await createTempWorkspace('boring-ui-bwrap-conformance-')
    const sandbox = createBwrapSandbox()
    await sandbox.init?.({ workspace: temp.workspace, sessionId: 'conformance-bwrap' })

    return {
      sandbox,
      workspace: temp.workspace,
      cleanup: temp.cleanup,
    }
  },
  {
    skip: !HAS_BWRAP,
    skipReason: 'bwrap binary not available on PATH',
  },
)
