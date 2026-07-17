import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface Options {
  appRoot: string
  pluginsModule: string
  pluginsExport: string
  serverTsconfig: string
}

const scriptDir = dirname(fileURLToPath(import.meta.url))

function usage(): never {
  throw new Error([
    'Usage: tsx packages/workspace/scripts/build-app.mts [options]',
    '',
    'Options:',
    '  --app-root <dir>              App root (default: cwd)',
    '  --plugins-module <module>     Module exporting server plugins (default: ./src/server/plugins.ts)',
    '  --plugins-export <name>       Plugin export name (default: serverPlugins)',
    '  --server-tsconfig <path>      Server tsconfig (default: tsconfig.server.json)',
  ].join('\n'))
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    appRoot: process.cwd(),
    pluginsModule: './src/server/plugins.ts',
    pluginsExport: 'serverPlugins',
    serverTsconfig: 'tsconfig.server.json',
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--app-root' && next) {
      opts.appRoot = next
      i++
    } else if (arg === '--plugins-module' && next) {
      opts.pluginsModule = next
      i++
    } else if (arg === '--plugins-export' && next) {
      opts.pluginsExport = next
      i++
    } else if (arg === '--server-tsconfig' && next) {
      opts.serverTsconfig = next
      i++
    } else {
      usage()
    }
  }
  opts.appRoot = resolve(process.cwd(), opts.appRoot)
  return opts
}

function run(appRoot: string, command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

const opts = parseArgs(process.argv.slice(2))

// Server tsc does not clean stale output when files leave its compilation set.
rmSync(join(opts.appRoot, 'dist', 'server'), { recursive: true, force: true })
run(opts.appRoot, 'pnpm', ['exec', 'tsc', '-p', opts.serverTsconfig, '--noCheck'])
run(opts.appRoot, 'pnpm', [
  'exec',
  'tsx',
  join(scriptDir, 'copy-plugin-assets.mts'),
  '--app-root',
  opts.appRoot,
  '--plugins-module',
  opts.pluginsModule,
  '--export',
  opts.pluginsExport,
])
run(opts.appRoot, 'pnpm', ['exec', 'vite', 'build'])
