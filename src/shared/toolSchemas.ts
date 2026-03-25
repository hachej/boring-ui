/**
 * Shared tool schemas — THE source of truth for what the LLM can call.
 *
 * Hybrid bundle:
 * - Structured tools: read_file, write_file, list_dir, search_files, git_status, git_diff
 * - Shell tools: run_command, start_command, read_command_output, cancel_command
 * - UI bridge tools: open_file, list_tabs, open_panel
 *
 * Shared by PI and future AI SDK runtimes.
 * Transport-independent — no Fastify, tRPC, or React imports.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Structured tools (file/git operations)
// ---------------------------------------------------------------------------

/** Read a file's content. */
export const ReadFileSchema = z.object({
  path: z.string().min(1, 'path is required'),
})

/** Write content to a file (creates parent dirs if needed). */
export const WriteFileSchema = z.object({
  path: z.string().min(1, 'path is required'),
  content: z.string(),
})

/** List directory entries. */
export const ListDirSchema = z.object({
  path: z.string().optional(),
  recursive: z.boolean().optional(),
})

/** Search for files matching a pattern. */
export const SearchFilesSchema = z.object({
  pattern: z.string().min(1, 'pattern is required'),
  path: z.string().optional(),
})

/** Get git status. */
export const GitStatusSchema = z.object({
  path: z.string().optional(),
})

/** Get git diff. */
export const GitDiffSchema = z.object({
  path: z.string().optional(),
  staged: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// Shell tools (command execution)
// ---------------------------------------------------------------------------

/** Run a command and wait for completion (short-lived). */
export const RunCommandSchema = z.object({
  command: z.string().min(1, 'command is required'),
  cwd: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
})

/** Start a long-running command as a background job. */
export const StartCommandSchema = z.object({
  command: z.string().min(1, 'command is required'),
  cwd: z.string().optional(),
})

/** Read output chunks from a running command job. */
export const ReadCommandOutputSchema = z.object({
  job_id: z.string().min(1, 'job_id is required'),
})

/** Cancel a running command job. */
export const CancelCommandSchema = z.object({
  job_id: z.string().min(1, 'job_id is required'),
})

// ---------------------------------------------------------------------------
// UI bridge tools (frontend-only, sent via postMessage)
// ---------------------------------------------------------------------------

/** Open a file in the editor panel. */
export const OpenFileSchema = z.object({
  path: z.string().min(1, 'path is required'),
})

/** List currently open editor tabs. */
export const ListTabsSchema = z.object({})

/** Open a specific panel by ID. */
export const OpenPanelSchema = z.object({
  panel_id: z.string().min(1, 'panel_id is required'),
})

// ---------------------------------------------------------------------------
// Tool registry — flat record for lookup by name
// ---------------------------------------------------------------------------

export const TOOL_SCHEMAS = {
  read_file: ReadFileSchema,
  write_file: WriteFileSchema,
  list_dir: ListDirSchema,
  search_files: SearchFilesSchema,
  git_status: GitStatusSchema,
  git_diff: GitDiffSchema,
  run_command: RunCommandSchema,
  start_command: StartCommandSchema,
  read_command_output: ReadCommandOutputSchema,
  cancel_command: CancelCommandSchema,
  open_file: OpenFileSchema,
  list_tabs: ListTabsSchema,
  open_panel: OpenPanelSchema,
} as const

/** Tool name union type derived from the registry. */
export type ToolName = keyof typeof TOOL_SCHEMAS

/** Infer the input type for a given tool. */
export type ToolInput<T extends ToolName> = z.infer<(typeof TOOL_SCHEMAS)[T]>
