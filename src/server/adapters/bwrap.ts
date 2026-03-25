/**
 * BwrapBackend adapter — provides sandboxed file/exec operations via bubblewrap.
 * Stub — implementation in Phase 2 (bd-qvv02.1).
 *
 * When implemented, this adapter will:
 * - Wrap file operations in bwrap sandboxing
 * - Provide exec() with bubblewrap isolation
 * - Declare its capabilities: workspace.files, workspace.exec, workspace.git, workspace.python
 */

export interface WorkspaceBackend {
  readonly name: string
  readonly capabilities: string[]
}

export function createBwrapBackend(_workspaceRoot: string): WorkspaceBackend {
  throw new Error('Not implemented — see bd-qvv02.1: BwrapBackend')
}
