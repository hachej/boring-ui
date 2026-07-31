import type { LoadConfigOptions } from './config/index.js'
import { readConfigFileSecret } from './config/fileSecrets.js'
import { runMigrations, type RunMigrationsOptions } from './db/index.js'
import { ConfigValidationError } from '../shared/errors.js'

export interface RunCoreMigrationsFromEnvOptions extends RunMigrationsOptions {
  loadConfigOptions?: LoadConfigOptions
  log?: Pick<Console, 'log'>
}

export async function runCoreMigrationsFromEnv(
  options: RunCoreMigrationsFromEnvOptions = {},
): Promise<void> {
  // Schema deployment only needs DATABASE_URL; unrelated runtime secrets must not block migrations.
  await runMigrations({ databaseUrl: resolveMigrationDatabaseUrl(options.loadConfigOptions) }, options)
  options.log?.log('migrations complete')
}

function resolveMigrationDatabaseUrl(options?: Pick<LoadConfigOptions, 'env'>): string | null {
  const env = options?.env ?? (process.env as Record<string, string | undefined>)
  if (env.DATABASE_URL !== undefined && env.DATABASE_URL_FILE !== undefined) {
    throw new ConfigValidationError([{
      message: 'DATABASE_URL and DATABASE_URL_FILE cannot both be set',
      path: ['env', 'DATABASE_URL_FILE'],
    }])
  }
  if (env.DATABASE_URL_FILE !== undefined) {
    return readConfigFileSecret('DATABASE_URL_FILE', env.DATABASE_URL_FILE)
  }
  return env.DATABASE_URL ?? null
}
