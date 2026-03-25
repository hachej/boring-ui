/**
 * TDD tests for bd-5q0dt: Shared tool schemas.
 *
 * Tests that Zod schemas validate correct input and reject bad input.
 * Target: ~30 test cases, <2 seconds.
 */
import { describe, it, expect } from 'vitest'
import {
  // Structured tools
  ReadFileSchema,
  WriteFileSchema,
  ListDirSchema,
  SearchFilesSchema,
  GitStatusSchema,
  GitDiffSchema,
  // Shell tools
  RunCommandSchema,
  StartCommandSchema,
  ReadCommandOutputSchema,
  CancelCommandSchema,
  // UI bridge tools
  OpenFileSchema,
  ListTabsSchema,
  OpenPanelSchema,
  // Tool registry
  TOOL_SCHEMAS,
} from '../toolSchemas.js'

// -----------------------------------------------------------------------
// Structured tools
// -----------------------------------------------------------------------
describe('ReadFileSchema', () => {
  it('accepts valid input', () => {
    const result = ReadFileSchema.safeParse({ path: 'src/main.ts' })
    expect(result.success).toBe(true)
  })

  it('rejects missing path', () => {
    const result = ReadFileSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty path', () => {
    const result = ReadFileSchema.safeParse({ path: '' })
    expect(result.success).toBe(false)
  })
})

describe('WriteFileSchema', () => {
  it('accepts valid input', () => {
    const result = WriteFileSchema.safeParse({
      path: 'output.txt',
      content: 'hello world',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing content', () => {
    const result = WriteFileSchema.safeParse({ path: 'file.txt' })
    expect(result.success).toBe(false)
  })

  it('rejects missing path', () => {
    const result = WriteFileSchema.safeParse({ content: 'hi' })
    expect(result.success).toBe(false)
  })

  it('accepts empty content (for creating empty files)', () => {
    const result = WriteFileSchema.safeParse({ path: 'empty.txt', content: '' })
    expect(result.success).toBe(true)
  })
})

describe('ListDirSchema', () => {
  it('accepts empty input (defaults to root)', () => {
    const result = ListDirSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts path parameter', () => {
    const result = ListDirSchema.safeParse({ path: 'src' })
    expect(result.success).toBe(true)
  })

  it('accepts recursive flag', () => {
    const result = ListDirSchema.safeParse({ path: '.', recursive: true })
    expect(result.success).toBe(true)
  })
})

describe('SearchFilesSchema', () => {
  it('accepts pattern', () => {
    const result = SearchFilesSchema.safeParse({ pattern: '*.ts' })
    expect(result.success).toBe(true)
  })

  it('rejects missing pattern', () => {
    const result = SearchFilesSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('accepts optional path', () => {
    const result = SearchFilesSchema.safeParse({
      pattern: 'TODO',
      path: 'src',
    })
    expect(result.success).toBe(true)
  })
})

describe('GitStatusSchema', () => {
  it('accepts empty input', () => {
    const result = GitStatusSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts optional path', () => {
    const result = GitStatusSchema.safeParse({ path: 'src' })
    expect(result.success).toBe(true)
  })
})

describe('GitDiffSchema', () => {
  it('accepts empty input', () => {
    const result = GitDiffSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts file path', () => {
    const result = GitDiffSchema.safeParse({ path: 'README.md' })
    expect(result.success).toBe(true)
  })

  it('accepts staged flag', () => {
    const result = GitDiffSchema.safeParse({ staged: true })
    expect(result.success).toBe(true)
  })
})

// -----------------------------------------------------------------------
// Shell tools
// -----------------------------------------------------------------------
describe('RunCommandSchema', () => {
  it('accepts command string', () => {
    const result = RunCommandSchema.safeParse({ command: 'ls -la' })
    expect(result.success).toBe(true)
  })

  it('rejects missing command', () => {
    const result = RunCommandSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('accepts optional cwd', () => {
    const result = RunCommandSchema.safeParse({
      command: 'npm test',
      cwd: 'packages/core',
    })
    expect(result.success).toBe(true)
  })

  it('accepts optional timeout', () => {
    const result = RunCommandSchema.safeParse({
      command: 'sleep 5',
      timeout_ms: 10000,
    })
    expect(result.success).toBe(true)
  })
})

describe('StartCommandSchema', () => {
  it('accepts command string', () => {
    const result = StartCommandSchema.safeParse({ command: 'npm run build' })
    expect(result.success).toBe(true)
  })

  it('rejects missing command', () => {
    const result = StartCommandSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe('ReadCommandOutputSchema', () => {
  it('accepts job_id', () => {
    const result = ReadCommandOutputSchema.safeParse({ job_id: 'abc-123' })
    expect(result.success).toBe(true)
  })

  it('rejects missing job_id', () => {
    const result = ReadCommandOutputSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe('CancelCommandSchema', () => {
  it('accepts job_id', () => {
    const result = CancelCommandSchema.safeParse({ job_id: 'abc-123' })
    expect(result.success).toBe(true)
  })

  it('rejects missing job_id', () => {
    const result = CancelCommandSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

// -----------------------------------------------------------------------
// UI bridge tools
// -----------------------------------------------------------------------
describe('OpenFileSchema', () => {
  it('accepts file path', () => {
    const result = OpenFileSchema.safeParse({ path: 'README.md' })
    expect(result.success).toBe(true)
  })

  it('rejects missing path', () => {
    const result = OpenFileSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe('ListTabsSchema', () => {
  it('accepts empty input', () => {
    const result = ListTabsSchema.safeParse({})
    expect(result.success).toBe(true)
  })
})

describe('OpenPanelSchema', () => {
  it('accepts panel_id', () => {
    const result = OpenPanelSchema.safeParse({ panel_id: 'terminal' })
    expect(result.success).toBe(true)
  })

  it('rejects missing panel_id', () => {
    const result = OpenPanelSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

// -----------------------------------------------------------------------
// Tool registry
// -----------------------------------------------------------------------
describe('TOOL_SCHEMAS registry', () => {
  it('exports all tool schemas in a flat record', () => {
    expect(TOOL_SCHEMAS).toBeDefined()
    expect(TOOL_SCHEMAS.read_file).toBe(ReadFileSchema)
    expect(TOOL_SCHEMAS.write_file).toBe(WriteFileSchema)
    expect(TOOL_SCHEMAS.list_dir).toBe(ListDirSchema)
    expect(TOOL_SCHEMAS.search_files).toBe(SearchFilesSchema)
    expect(TOOL_SCHEMAS.git_status).toBe(GitStatusSchema)
    expect(TOOL_SCHEMAS.git_diff).toBe(GitDiffSchema)
    expect(TOOL_SCHEMAS.run_command).toBe(RunCommandSchema)
    expect(TOOL_SCHEMAS.start_command).toBe(StartCommandSchema)
    expect(TOOL_SCHEMAS.read_command_output).toBe(ReadCommandOutputSchema)
    expect(TOOL_SCHEMAS.cancel_command).toBe(CancelCommandSchema)
    expect(TOOL_SCHEMAS.open_file).toBe(OpenFileSchema)
    expect(TOOL_SCHEMAS.list_tabs).toBe(ListTabsSchema)
    expect(TOOL_SCHEMAS.open_panel).toBe(OpenPanelSchema)
  })

  it('has 13 tools total', () => {
    expect(Object.keys(TOOL_SCHEMAS)).toHaveLength(13)
  })
})

// -----------------------------------------------------------------------
// JSON serialization round-trip
// -----------------------------------------------------------------------
describe('JSON serialization', () => {
  it('ReadFileSchema round-trips through JSON', () => {
    const input = { path: 'test/file.ts' }
    const parsed = ReadFileSchema.parse(input)
    const json = JSON.stringify(parsed)
    const reparsed = ReadFileSchema.parse(JSON.parse(json))
    expect(reparsed).toEqual(input)
  })

  it('WriteFileSchema round-trips through JSON', () => {
    const input = { path: 'out.txt', content: 'hello\nworld' }
    const parsed = WriteFileSchema.parse(input)
    const json = JSON.stringify(parsed)
    const reparsed = WriteFileSchema.parse(JSON.parse(json))
    expect(reparsed).toEqual(input)
  })

  it('RunCommandSchema round-trips through JSON', () => {
    const input = { command: 'echo "hi"', cwd: 'src', timeout_ms: 5000 }
    const parsed = RunCommandSchema.parse(input)
    const json = JSON.stringify(parsed)
    const reparsed = RunCommandSchema.parse(JSON.parse(json))
    expect(reparsed).toEqual(input)
  })
})
