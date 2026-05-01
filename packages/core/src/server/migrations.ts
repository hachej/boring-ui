import { loadConfig, type LoadConfigOptions } from './config/index.js'
import { runMigrations } from './db/index.js'

export interface RunCoreMigrationsFromEnvOptions {
  loadConfigOptions?: LoadConfigOptions
  log?: Pick<Console, 'log'>
}

export async function runCoreMigrationsFromEnv(
  options: RunCoreMigrationsFromEnvOptions = {},
): Promise<void> {
  const config = await loadConfig(options.loadConfigOptions)
  await runMigrations(config)
  options.log?.log('migrations complete')
}
