import { runCoreMigrationsFromEnv } from '@hachej/boring-core/server'
import { runBoringAutomationMigrations } from '@hachej/boring-automation/server'

async function main() {
  await runCoreMigrationsFromEnv({ log: console, additionalMigrations: [runBoringAutomationMigrations] })
}

main().catch((err) => {
  console.error('migration failed:', err)
  process.exit(1)
})
