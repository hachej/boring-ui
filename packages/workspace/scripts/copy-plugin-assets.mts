import { cp, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

interface StaticPluginAsset {
  name: string
  source: string | URL
  target?: string
}

interface ServerPluginWithAssets {
  id: string
  assets?: StaticPluginAsset[]
}

interface Options {
  appRoot: string
  pluginsModule: string
  exportName: string
}

function usage(): never {
  throw new Error([
    'Usage: tsx packages/workspace/scripts/copy-plugin-assets.mts --app-root <dir> --plugins-module <module> [--export <name>]',
    '',
    'Copies declared WorkspaceServerPlugin.assets to:',
    '  <app-root>/dist/plugins/<plugin-id>/<asset-target>',
  ].join('\n'))
}

function parseArgs(argv: string[]): Options {
  const opts: Partial<Options> = { exportName: 'serverPlugins' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--app-root' && next) {
      opts.appRoot = next
      i++
    } else if (arg === '--plugins-module' && next) {
      opts.pluginsModule = next
      i++
    } else if (arg === '--export' && next) {
      opts.exportName = next
      i++
    } else {
      usage()
    }
  }
  if (!opts.appRoot || !opts.pluginsModule || !opts.exportName) usage()
  return opts as Options
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as { code?: unknown })?.code === 'ENOENT') return false
    throw error
  }
}

function pathFromAssetSource(appRoot: string, source: string | URL): string {
  if (source instanceof URL) return fileURLToPath(source)
  return isAbsolute(source) ? source : join(appRoot, source)
}

function assertSafePathPart(value: string, label: string): void {
  if (!value || value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
    throw new Error(`${label} must be a non-empty single path segment: ${JSON.stringify(value)}`)
  }
}

function assertSafeRelativeTarget(value: string, label: string): void {
  if (!value || isAbsolute(value)) {
    throw new Error(`${label} must be a non-empty relative path: ${JSON.stringify(value)}`)
  }
  for (const part of value.split(/[\\/]+/)) {
    if (!part || part === '.' || part === '..') {
      throw new Error(`${label} contains an unsafe path segment: ${JSON.stringify(value)}`)
    }
  }
}

function assertInsideRoot(root: string, target: string, label: string): void {
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new Error(`${label} escapes app root: ${target}`)
  }
}

async function copyAsset(source: string, target: string): Promise<void> {
  await rm(target, { recursive: true, force: true })
  await cp(source, target, {
    recursive: true,
    filter: (path) => !path.includes('.egg-info') && !path.includes(`${sep}build${sep}`),
  })
}

const opts = parseArgs(process.argv.slice(2))
const appRoot = resolve(process.cwd(), opts.appRoot)
const pluginsModulePath = isAbsolute(opts.pluginsModule)
  ? opts.pluginsModule
  : resolve(appRoot, opts.pluginsModule)
const moduleExports = await import(pathToFileURL(pluginsModulePath).href)
const serverPlugins = moduleExports[opts.exportName] as unknown

if (!Array.isArray(serverPlugins)) {
  throw new Error(`${opts.pluginsModule} must export ${opts.exportName}: WorkspaceServerPlugin[]`)
}

for (const plugin of serverPlugins as ServerPluginWithAssets[]) {
  assertSafePathPart(plugin.id, 'plugin.id')
  for (const asset of plugin.assets ?? []) {
    assertSafePathPart(asset.name, `plugin ${plugin.id} asset.name`)
    const target = asset.target ?? asset.name
    assertSafeRelativeTarget(target, `plugin ${plugin.id} asset ${asset.name} target`)

    const source = pathFromAssetSource(appRoot, asset.source)
    if (!(await exists(source))) {
      throw new Error(`plugin ${plugin.id} declared missing asset ${asset.name}: ${source}`)
    }

    const distTarget = resolve(appRoot, 'dist', 'plugins', plugin.id, target)
    assertInsideRoot(appRoot, distTarget, `plugin ${plugin.id} dist asset target`)

    await copyAsset(source, distTarget)
  }
}
