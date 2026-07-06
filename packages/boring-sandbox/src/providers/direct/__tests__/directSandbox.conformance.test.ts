import { sandboxConformance } from '../../__tests__/conformance/sandbox'
import { createTempWorkspace } from '../../__tests__/helpers'
import { createDirectSandbox } from '../createDirectSandbox'

sandboxConformance('direct-sandbox', async () => {
  const temp = await createTempWorkspace('boring-ui-direct-conformance-')
  const sandbox = createDirectSandbox()
  await sandbox.init?.({ workspace: temp.workspace, sessionId: 'conformance-direct' })

  return {
    sandbox,
    workspace: temp.workspace,
    cleanup: temp.cleanup,
  }
})
