import { resolveDatabaseUrl, type LoadConfigOptions } from './config/index.js'
import { runMigrations, type RunMigrationsOptions } from './db/index.js'

export interface RunCoreMigrationsFromEnvOptions extends RunMigrationsOptions {
  loadConfigOptions?: LoadConfigOptions
  log?: Pick<Console, 'log'>
}

export async function runCoreMigrationsFromEnv(
  options: RunCoreMigrationsFromEnvOptions = {},
): Promise<void> {
  // Schema deployment only needs DATABASE_URL; unrelated runtime secrets must not block migrations.
  await runMigrations({ databaseUrl: resolveDatabaseUrl(options.loadConfigOptions) }, options)
  options.log?.log('migrations complete')
}
