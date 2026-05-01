import { loadConfig } from '@boring/core/server'
import { runMigrations } from '@boring/core/server/db'

async function main() {
  const config = await loadConfig()
  await runMigrations(config)
  console.log('migrations complete')
}

main().catch((err) => {
  console.error('migration failed:', err)
  process.exit(1)
})
