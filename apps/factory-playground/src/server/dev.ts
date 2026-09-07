import { resolve } from 'node:path'
import { createFactoryPlayground } from './app'

export const FACTORY_UI_PORT = Number(process.env.PORT) || 5220
export const FACTORY_API_PORT = Number(process.env.AGENT_API_PORT) || 5230
export const FACTORY_APP_ROOT = resolve(import.meta.dirname, '../..')
export const FACTORY_REPOSITORY_ROOT = resolve(FACTORY_APP_ROOT, '../..')

let boot: Promise<void> | undefined

export async function startFactoryPlaygroundServer(): Promise<void> {
  if (boot) return boot
  boot = (async () => {
    const app = await createFactoryPlayground({
      appRoot: FACTORY_APP_ROOT,
      repositoryRoot: FACTORY_REPOSITORY_ROOT,
    })
    await app.listen({ host: '127.0.0.1', port: FACTORY_API_PORT })
  })()
  return boot
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startFactoryPlaygroundServer().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
