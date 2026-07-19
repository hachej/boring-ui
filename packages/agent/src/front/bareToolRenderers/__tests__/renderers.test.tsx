import { renderToStaticMarkup } from 'react-dom/server'
import { describe, test, expect } from 'vitest'
import { buildFilesystemAgentTools } from '@hachej/boring-bash/agent'
import {
  defaultToolRenderers,
  mergeToolRenderers,
  resolveToolRenderer,
  resolveToolRendererForPart,
  toToolPart,
  type ToolPart,
} from '../renderers'
import type { RuntimeBundle } from '../../../server/runtime/mode'

function makePart(overrides: Partial<ToolPart> & { toolName: string }): ToolPart {
  return {
    type: `tool-${overrides.toolName}`,
    toolCallId: 'call-1',
    state: 'output-available',
    ...overrides,
  }
}

function mockBundle(provider: string): RuntimeBundle {
  const runtimeContext = { runtimeCwd: '/workspace' }
  return {
    runtimeContext,
    storageRoot: provider === 'vercel-sandbox' ? undefined : runtimeContext.runtimeCwd,
    workspace: {
      root: runtimeContext.runtimeCwd,
      runtimeContext,
      readFile: async () => '',
      writeFile: async () => {},
      unlink: async () => {},
      readdir: async () => [],
      stat: async () => ({ size: 0, mtimeMs: 0, kind: 'file' as const }),
      mkdir: async () => {},
      rename: async () => {},
    },
    sandbox: {
      id: `renderer-${provider}`,
      placement: provider === 'vercel-sandbox' ? 'remote' : 'server',
      provider,
      capabilities: ['exec'],
      runtimeContext,
      exec: async () => ({
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
        exitCode: 0,
        durationMs: 0,
        truncated: false,
      }),
    },
    fileSearch: { search: async () => [] },
    filesystem: provider === 'vercel-sandbox' ? { kind: 'remote-workspace' } : { kind: 'host' },
  }
}

function filesystemToolNames(provider: string): string[] {
  return buildFilesystemAgentTools(mockBundle(provider)).map((tool) => tool.name)
}

describe('bash renderer', () => {
  test('renders Terminal with command and output', () => {
    const part = makePart({
      toolName: 'bash',
      input: { command: 'ls -la' },
      output: { stdout: 'file.txt\ndir/', stderr: '', exitCode: 0 },
    })
    const html = renderToStaticMarkup(<>{defaultToolRenderers.bash(part)}</>)
    expect(html).toContain('$ ls -la')
    expect(html).toContain('file.txt')
    expect(html).toContain('exit 0')
  })

  test('renders stderr', () => {
    const part = makePart({
      toolName: 'bash',
      input: { command: 'fail' },
      output: { stdout: '', stderr: 'error msg', exitCode: 1 },
    })
    const html = renderToStaticMarkup(<>{defaultToolRenderers.bash(part)}</>)
    expect(html).toContain('error msg')
    expect(html).toContain('exit 1')
  })
})

describe('read renderer', () => {
  test('renders tool header with read name', () => {
    const part = makePart({
      toolName: 'read',
      input: { path: 'src/index.ts' },
      output: { content: [{ text: 'const x = 1' }] },
    })
    const html = renderToStaticMarkup(<>{defaultToolRenderers.read(part)}</>)
    expect(html).toContain('read')
    expect(html).toContain('Done')
  })

  test('shows running indicator during input-available', () => {
    const part = makePart({
      toolName: 'read',
      state: 'input-available',
      input: { path: 'file.py' },
    })
    const html = renderToStaticMarkup(<>{defaultToolRenderers.read(part)}</>)
    expect(html).toContain('Running')
    expect(html).toContain('aria-label="running"')
  })
})

describe('write renderer', () => {
  test('renders byte count and path', () => {
    const part = makePart({
      toolName: 'write',
      input: { path: 'out.json', content: '{"ok":true}' },
    })
    const html = renderToStaticMarkup(<>{defaultToolRenderers.write(part)}</>)
    expect(html).toContain('11 bytes')
    expect(html).toContain('out.json')
  })
})

describe('edit renderer', () => {
  test('renders DiffView with old/new strings', () => {
    const part = makePart({
      toolName: 'edit',
      input: { path: 'app.ts', oldString: 'foo', newString: 'bar' },
    })
    const html = renderToStaticMarkup(<>{defaultToolRenderers.edit(part)}</>)
    expect(html).toContain('data-testid="diff-view"')
    expect(html).toContain('app.ts')
  })
})

describe('filesystem renderer coverage', () => {
  test.each(['direct', 'bwrap', 'vercel-sandbox'])(
    'default renderers cover every %s filesystem tool',
    (provider) => {
      const missing = filesystemToolNames(provider).filter((name) => !defaultToolRenderers[name])
      expect(missing).toEqual([])
    },
  )
})

describe('get_ui_state renderer', () => {
  test('renders tool header (collapsed by default)', () => {
    const part = makePart({
      toolName: 'get_ui_state',
      input: {},
      output: { theme: 'dark', count: 42 },
    })
    const html = renderToStaticMarkup(<>{defaultToolRenderers.get_ui_state(part)}</>)
    expect(html).toContain('get_ui_state')
    expect(html).toContain('aria-expanded="false"')
  })
})

describe('exec_ui renderer', () => {
  test('renders kind + params as one-line summary', () => {
    const part = makePart({
      toolName: 'exec_ui',
      input: { kind: 'openFile', params: { path: 'src/README.md', mode: 'edit' } },
    })
    const html = renderToStaticMarkup(<>{defaultToolRenderers.exec_ui(part)}</>)
    expect(html).toContain('openFile')
    expect(html).toContain('src/README.md')
    expect(html).toContain('edit')
  })

  test('renders an unknown kind generically (no per-kind switch)', () => {
    const part = makePart({
      toolName: 'exec_ui',
      input: { kind: 'futureKind', params: { foo: 'bar' } },
    })
    const html = renderToStaticMarkup(<>{defaultToolRenderers.exec_ui(part)}</>)
    expect(html).toContain('futureKind')
    expect(html).toContain('foo')
    expect(html).toContain('bar')
  })

  test('renders error text (e.g. file_not_found from path validation)', () => {
    const part = makePart({
      toolName: 'exec_ui',
      state: 'output-error',
      input: { kind: 'openFile', params: { path: 'README.md' } },
      errorText: 'file not found at "README.md" — try find',
    })
    const html = renderToStaticMarkup(<>{defaultToolRenderers.exec_ui(part)}</>)
    expect(html).toContain('file not found')
  })
})

describe('resolveToolRenderer', () => {
  test('mergeToolRenderers deep-merges overrides with defaults', () => {
    const customBash = () => <div>custom bash</div>
    const merged = mergeToolRenderers({
      bash: customBash,
    })

    expect(merged.bash).toBe(customBash)
    expect(merged.read).toBe(defaultToolRenderers.read)
    expect(merged.edit).toBe(defaultToolRenderers.edit)
  })

  test('returns default renderer for known tool', () => {
    const renderer = resolveToolRenderer('bash')
    expect(renderer).toBe(defaultToolRenderers.bash)
  })

  test('returns fallback for unknown tool', () => {
    const renderer = resolveToolRenderer('unknown_tool')
    const part = makePart({
      toolName: 'unknown_tool',
      input: { arbitrary: { nested: ['plugin', 1] } },
      output: { ok: true, count: 2 },
    })
    const html = renderToStaticMarkup(<>{renderer(part)}</>)
    expect(html).toContain('unknown_tool')
    expect(html).toContain('&quot;arbitrary&quot;')
    expect(html).toContain('&quot;nested&quot;')
    expect(html).toContain('&quot;plugin&quot;')
    expect(html).toContain('&quot;ok&quot;')
    expect(html).toContain('&quot;count&quot;')
    expect(html).toContain('aria-expanded="true"')
  })

  test('override takes precedence over default', () => {
    const custom = () => <div data-testid="custom">Custom bash</div>
    const renderer = resolveToolRenderer('bash', { bash: custom })
    expect(renderer).toBe(custom)
    const html = renderToStaticMarkup(<>{renderer(makePart({ toolName: 'bash' }))}</>)
    expect(html).toContain('Custom bash')
  })

  test('override only affects specified tools', () => {
    const custom = () => <div>Custom</div>
    const bashRenderer = resolveToolRenderer('bash', { read: custom })
    expect(bashRenderer).toBe(defaultToolRenderers.bash)
    const readRenderer = resolveToolRenderer('read', { read: custom })
    expect(readRenderer).toBe(custom)
  })

  test('unknown tool uses __fallback override when provided', () => {
    const customFallback = () => <div data-testid="fallback">Fallback</div>
    const renderer = resolveToolRenderer('plugin_tool', {
      __fallback: customFallback,
    })
    expect(renderer).toBe(customFallback)
    const html = renderToStaticMarkup(<>{renderer(makePart({ toolName: 'plugin_tool' }))}</>)
    expect(html).toContain('Fallback')
  })

  test('named default renderer beats __fallback override for known tools', () => {
    const customFallback = () => <div>Fallback</div>
    const renderer = resolveToolRenderer('edit', {
      __fallback: customFallback,
    })
    expect(renderer).toBe(defaultToolRenderers.edit)
  })

  test('toToolPart adapts BoringChatPart tool-call id and top-level ui metadata', () => {
    const part = toToolPart({
      type: 'tool-call',
      id: 'pi-call-7',
      toolName: 'plugin_tool',
      state: 'aborted',
      input: { ok: true },
      ui: { rendererId: 'plugin-card', details: { row: 1 } },
    })

    expect(part).toEqual(expect.objectContaining({
      type: 'tool-call',
      toolCallId: 'pi-call-7',
      toolName: 'plugin_tool',
      state: 'aborted',
      ui: { rendererId: 'plugin-card', details: { row: 1 } },
    }))
  })

  test('resolveToolRendererForPart makes rendererId-vs-toolName collisions deterministic', () => {
    const rendererById = () => <div>renderer id</div>
    const rendererByToolName = () => <div>tool name</div>
    const part = makePart({
      toolName: 'bash',
      output: { details: { ui: { rendererId: 'plugin-card' } } },
    })
    const adapted = toToolPart(part)!

    const resolved = resolveToolRendererForPart(adapted, {
      'plugin-card': rendererById,
      bash: rendererByToolName,
    })

    expect(resolved.renderer).toBe(rendererById)
    expect(resolved.resolution).toEqual({ key: 'plugin-card', source: 'rendererId', requestedRendererId: 'plugin-card' })
    expect(resolved.part.rendererResolution).toEqual(resolved.resolution)
  })
})
