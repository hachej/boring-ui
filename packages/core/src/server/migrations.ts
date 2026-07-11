import { loadConfig, type LoadConfigOptions } from './config/index.js'
import { runMigrations, type RunMigrationsOptions } from './db/index.js'

export interface RunCoreMigrationsFromEnvOptions extends RunMigrationsOptions {
  loadConfigOptions?: LoadConfigOptions
  log?: Pick<Console, 'log'>
}

export async function runCoreMigrationsFromEnv(
  options: RunCoreMigrationsFromEnvOptions = {},
): Promise<void> {
  const config = await loadConfig(options.loadConfigOptions)
  await runMigrations(config, options)
  options.log?.log('migrations complete')
}
