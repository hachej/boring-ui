import { workspaceConformance } from '../../__tests__/conformance/workspace'
import { createTempWorkspace } from '../../__tests__/helpers'

workspaceConformance('node-workspace', async () => {
  const temp = await createTempWorkspace('boring-ui-node-conformance-')
  return {
    workspace: temp.workspace,
    cleanup: temp.cleanup,
  }
})
