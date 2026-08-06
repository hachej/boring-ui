import type { LoadConfigOptions } from './config/index.js'
import { resolveConfigFileSecrets } from './config/fileSecrets.js'
import { runMigrations, type RunMigrationsOptions } from './db/index.js'

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
  const fileSecrets = resolveConfigFileSecrets({
    DATABASE_URL: env.DATABASE_URL,
    DATABASE_URL_FILE: env.DATABASE_URL_FILE,
  })
  return fileSecrets.DATABASE_URL ?? env.DATABASE_URL ?? null
}
