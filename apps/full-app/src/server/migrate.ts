import { runCoreMigrationsFromEnv } from '@hachej/boring-core/server'

async function main() {
  await runCoreMigrationsFromEnv({ log: console })
}

main().catch((err) => {
  console.error('migration failed:', err)
  process.exit(1)
})
