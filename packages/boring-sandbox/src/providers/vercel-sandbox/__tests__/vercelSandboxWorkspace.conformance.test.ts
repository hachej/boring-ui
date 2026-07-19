import { workspaceConformance } from '../../__tests__/conformance/workspace'
import { createVercelSandboxWorkspace } from '../createVercelSandboxWorkspace'
import { createMockVercelSandboxHarness } from './mockVercelSandbox'

workspaceConformance('vercel-sandbox-workspace', async () => {
  const harness = await createMockVercelSandboxHarness()
  return {
    workspace: createVercelSandboxWorkspace(harness.sandbox),
    cleanup: harness.cleanup,
  }
})
