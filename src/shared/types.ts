/**
 * Shared types used by both server and (potentially) frontend.
 * Transport-independent — no Fastify, tRPC, or React imports.
 */

// --- File operations ---

export interface DirectoryEntry {
  name: string
  path: string
  is_dir: boolean
}

export interface FileListResult {
  entries: DirectoryEntry[]
  path: string
}

export interface FileReadResult {
  content: string
  path: string
}

export interface FileWriteResult {
  success: boolean
  path: string
}

export interface FileDeleteResult {
  success: boolean
  path: string
}

export interface FileRenameResult {
  success: boolean
  old_path: string
  new_path: string
}

export interface FileMoveResult {
  success: boolean
  old_path: string
  dest_path: string
}

export interface FileSearchMatch {
  name: string
  path: string
  dir: string
}

export interface FileSearchResult {
  results: FileSearchMatch[]
  pattern: string
  path: string
}

// --- Git operations ---

export interface GitFileStatus {
  path: string
  status: string
}

export interface GitStatusResult {
  is_repo: boolean
  available: boolean
  files: GitFileStatus[]
}

export interface GitDiffResult {
  diff: string
  path: string
}

export interface GitShowResult {
  content: string | null
  path: string
  error?: string
}

export interface GitCredentials {
  username: string
  password: string
}

// --- Auth / Session ---

export interface SessionPayload {
  user_id: string
  email: string
  exp: number
  app_id?: string
}

// --- Workspace ---

export interface Workspace {
  id: string
  name: string
  owner_id: string
  is_default?: boolean
  created_at: string
  updated_at?: string
}

export interface WorkspaceMember {
  id: string
  workspace_id: string
  user_id: string
  role: string
  created_at: string
}

export interface WorkspaceInvite {
  id: string
  workspace_id: string
  email: string
  role: string
  status: string
  created_at: string
  expires_at?: string
}

export interface WorkspaceRuntime {
  workspace_id: string
  status: 'pending' | 'provisioned' | 'error'
  placement?: string
  agent_mode?: string
  error_message?: string
  updated_at?: string
}

// --- User ---

export interface User {
  id: string
  email: string
  name?: string
  created_at: string
}

// --- Approval ---

export interface ApprovalRequest {
  id: string
  tool_name: string
  description: string
  command?: string
  metadata?: Record<string, unknown>
  status: 'pending' | 'approve' | 'deny'
  created_at: string
  decided_at?: string
  reason?: string
}

// --- Capabilities ---

export interface RouterInfo {
  name: string
  prefix: string
  description: string
  tags: string[]
  enabled: boolean
}

export interface CapabilitiesResponse {
  version: string
  features: Record<string, boolean>
  routers: RouterInfo[]
  auth: {
    provider: string
    neonAuthUrl?: string
    callbackUrl?: string
  }
  workspace_runtime?: {
    placement: string
    agent_mode: string
  }
}
