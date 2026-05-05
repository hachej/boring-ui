import { createVercelFastifyHandler } from '@boring/core/app/server'

import { buildServer } from './index.js'

process.env.BORING_AGENT_MODE ??= 'vercel-sandbox'
process.env.BORING_AGENT_WORKSPACE_ROOT ??= '/tmp/boring-workspaces'

export default createVercelFastifyHandler({
  createServer: () => buildServer({
    appRoot: process.cwd(),
    serveFrontend: true,
    workspaceRoot: process.env.BORING_AGENT_WORKSPACE_ROOT,
  }),
})
