import { renderToStaticMarkup } from 'react-dom/server'
import { describe, test, expect } from 'vitest'
import {
  defaultToolRenderers,
  resolveToolRenderer,
  type ToolPart,
} from '../renderers'

function makePart(overrides: Partial<ToolPart> & { toolName: string }): ToolPart {
  return {
    type: `tool-${overrides.toolName}`,
    toolCallId: 'call-1',
    state: 'output-available',
    ...overrides,
  }
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
  test('renders compact command summary', () => {
    const part = makePart({
      toolName: 'exec_ui',
      input: { command: 'openFile', args: 'readme.md' },
    })
    const html = renderToStaticMarkup(<>{defaultToolRenderers.exec_ui(part)}</>)
    expect(html).toContain('→ openFile')
    expect(html).toContain('readme.md')
  })
})

describe('resolveToolRenderer', () => {
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
})
