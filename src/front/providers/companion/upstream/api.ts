import type { SdkSessionInfo } from "./types.js";
import { getCompanionBaseUrl, getAuthHeaders } from "../config.js";

const CANONICAL_PREFIX = "/api/v1/agent/companion";

function getWorkspaceBasePath(pathname: string = ""): string {
  const match = String(pathname || "").match(/^\/w\/[^/]+/);
  return match ? match[0] : "";
}

function getWorkspaceCanonicalPrefix(): string {
  if (typeof window === "undefined") return CANONICAL_PREFIX;
  const workspaceBase = getWorkspaceBasePath(window.location?.pathname || "");
  return workspaceBase ? `${workspaceBase}${CANONICAL_PREFIX}` : CANONICAL_PREFIX;
}

function getBase(): string {
  const base = (getCompanionBaseUrl() || "").trim();
  // Canonical agent-companion service boundary (Phase-1 contract freeze).
  // Keep same-origin requests workspace-aware when browsing /w/{workspace_id}/.
  if (!base) return getWorkspaceCanonicalPrefix();

  const normalized = base.replace(/\/+$/, "");
  if (typeof window === "undefined") return `${normalized}${CANONICAL_PREFIX}`;

  try {
    const parsed = new URL(normalized, window.location.origin);
    const sameOrigin = parsed.origin === window.location.origin;
    const pathname = parsed.pathname.replace(/\/+$/, "");

    if (pathname.endsWith(CANONICAL_PREFIX)) {
      return parsed.toString().replace(/\/+$/, "");
    }

    // For same-origin roots or workspace bases, prefer the current workspace path.
    if (sameOrigin && (pathname === "" || pathname === "/" || /^\/w\/[^/]+$/.test(pathname))) {
      return getWorkspaceCanonicalPrefix();
    }
  } catch {
    // Fall through and append canonical prefix.
  }

  return `${normalized}${CANONICAL_PREFIX}`;
}

async function post<T = unknown>(path: string, body?: object): Promise<T> {
  const res = await fetch(`${getBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

async function get<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${getBase()}${path}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

async function put<T = unknown>(path: string, body?: object): Promise<T> {
  const res = await fetch(`${getBase()}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

async function del<T = unknown>(path: string, body?: object): Promise<T> {
  const headers: Record<string, string> = { ...getAuthHeaders() };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${getBase()}${path}`, {
    method: "DELETE",
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export interface CreateSessionOpts {
  model?: string;
  permissionMode?: string;
  cwd?: string;
  claudeBinary?: string;
  allowedTools?: string[];
  envSlug?: string;
  branch?: string;
  createBranch?: boolean;
  useWorktree?: boolean;
}

export interface GitRepoInfo {
  repoRoot: string;
  repoName: string;
  currentBranch: string;
  defaultBranch: string;
  isWorktree: boolean;
}

export interface GitBranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  worktreePath: string | null;
  ahead: number;
  behind: number;
}

export interface GitWorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isMainWorktree: boolean;
  isDirty: boolean;
}

export interface WorktreeCreateResult {
  worktreePath: string;
  branch: string;
  isNew: boolean;
}

export interface CompanionEnv {
  name: string;
  slug: string;
  variables: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface DirEntry {
  name: string;
  path: string;
}

export interface DirListResult {
  path: string;
  dirs: DirEntry[];
  home: string;
  error?: string;
}

export const api = {
  createSession: (opts?: CreateSessionOpts) =>
    post<{ sessionId: string; state: string; cwd: string }>("/sessions/create", opts),

  listSessions: () =>
    get<SdkSessionInfo[]>("/sessions"),

  killSession: (sessionId: string) =>
    post(`/sessions/${encodeURIComponent(sessionId)}/kill`),

  deleteSession: (sessionId: string) =>
    del(`/sessions/${encodeURIComponent(sessionId)}`),

  relaunchSession: (sessionId: string) =>
    post(`/sessions/${encodeURIComponent(sessionId)}/relaunch`),

  archiveSession: (sessionId: string, opts?: { force?: boolean }) =>
    post(`/sessions/${encodeURIComponent(sessionId)}/archive`, opts),

  unarchiveSession: (sessionId: string) =>
    post(`/sessions/${encodeURIComponent(sessionId)}/unarchive`),

  listDirs: (path?: string) =>
    get<DirListResult>(`/fs/list${path ? `?path=${encodeURIComponent(path)}` : ""}`),

  getHome: () =>
    get<{ home: string; cwd: string }>("/fs/home"),

  // Environments
  listEnvs: () => get<CompanionEnv[]>("/envs"),
  getEnv: (slug: string) => get<CompanionEnv>(`/envs/${encodeURIComponent(slug)}`),
  createEnv: (name: string, variables: Record<string, string>) =>
    post<CompanionEnv>("/envs", { name, variables }),
  updateEnv: (slug: string, data: { name?: string; variables?: Record<string, string> }) =>
    put<CompanionEnv>(`/envs/${encodeURIComponent(slug)}`, data),
  deleteEnv: (slug: string) => del(`/envs/${encodeURIComponent(slug)}`),

  // Git operations
  getRepoInfo: (path: string) =>
    get<GitRepoInfo>(`/git/repo-info?path=${encodeURIComponent(path)}`),
  listBranches: (repoRoot: string) =>
    get<GitBranchInfo[]>(`/git/branches?repoRoot=${encodeURIComponent(repoRoot)}`),
  listWorktrees: (repoRoot: string) =>
    get<GitWorktreeInfo[]>(`/git/worktrees?repoRoot=${encodeURIComponent(repoRoot)}`),
  createWorktree: (repoRoot: string, branch: string, opts?: { baseBranch?: string; createBranch?: boolean }) =>
    post<WorktreeCreateResult>("/git/worktree", { repoRoot, branch, ...opts }),
  removeWorktree: (repoRoot: string, worktreePath: string, force?: boolean) =>
    del<{ removed: boolean; reason?: string }>("/git/worktree", { repoRoot, worktreePath, force }),
  gitFetch: (repoRoot: string) =>
    post<{ success: boolean; output: string }>("/git/fetch", { repoRoot }),
  gitPull: (cwd: string) =>
    post<{ success: boolean; output: string; git_ahead: number; git_behind: number }>("/git/pull", { cwd }),
};
