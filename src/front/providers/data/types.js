/**
 * DataProvider type definitions.
 *
 * All async methods accept an optional `{ signal: AbortSignal }` parameter
 * for cooperative cancellation (TanStack Query passes AbortSignal automatically).
 *
 * @module providers/data/types
 */

/**
 * Git status code for a single file.
 * - 'M' = modified
 * - 'U' = untracked
 * - 'A' = added (staged)
 * - 'D' = deleted
 * - 'C' = conflict
 *
 * @typedef {'M'|'U'|'A'|'D'|'C'} GitStatusCode
 */

/**
 * A single entry in a directory listing.
 *
 * @typedef {Object} FileEntry
 * @property {string} name      - File or directory name (not full path).
 * @property {boolean} is_dir   - True when the entry is a directory.
 * @property {string} [path]    - Full path relative to project root (optional).
 * @property {number} [size]    - Size in bytes (files only, optional).
 * @property {string} [mtime]   - Last-modified timestamp ISO-8601 (optional).
 */

/**
 * A search result entry.
 *
 * @typedef {Object} SearchResult
 * @property {string} path      - Path relative to project root.
 * @property {boolean} [is_dir] - True when the result is a directory (optional).
 * @property {string} [line]    - Matching line content (optional).
 * @property {number} [line_number] - Line number of the match (optional).
 */

/**
 * A single file's git status.
 *
 * @typedef {Object} GitFileStatus
 * @property {string} path          - File path relative to project root.
 * @property {GitStatusCode} status - Status code.
 */

/**
 * Aggregated git status for the working tree.
 *
 * @typedef {Object} GitStatus
 * @property {GitFileStatus[]} files - Array of file statuses.
 */

/**
 * Files provider — read, write, and search filesystem entries.
 *
 * @typedef {Object} FilesProvider
 * @property {(dir: string, opts?: { signal?: AbortSignal }) => Promise<FileEntry[]>} list
 *   List directory contents.
 * @property {(path: string, opts?: { signal?: AbortSignal }) => Promise<string>} read
 *   Read file contents as UTF-8 text.
 * @property {(path: string, content: string, opts?: { signal?: AbortSignal }) => Promise<void>} write
 *   Write (create or overwrite) a file.
 * @property {(path: string, opts?: { signal?: AbortSignal }) => Promise<void>} delete
 *   Delete a file.
 * @property {(oldPath: string, newName: string, opts?: { signal?: AbortSignal }) => Promise<void>} rename
 *   Rename a file (same directory, new name).
 * @property {(srcPath: string, destPath: string, opts?: { signal?: AbortSignal }) => Promise<void>} move
 *   Move a file to a new location.
 * @property {(query: string, opts?: { signal?: AbortSignal }) => Promise<SearchResult[]>} search
 *   Search file names/contents.
 */

/**
 * A git remote entry.
 *
 * @typedef {Object} GitRemote
 * @property {string} remote - Remote name (e.g. 'origin').
 * @property {string} url    - Remote URL.
 */

/**
 * Git author identity.
 *
 * @typedef {Object} GitAuthor
 * @property {string} name  - Author name.
 * @property {string} email - Author email.
 */

/**
 * Options for git push/pull/clone that may need auth and a CORS proxy.
 *
 * @typedef {Object} GitRemoteOpts
 * @property {string} [remote]    - Remote name (default: 'origin').
 * @property {string} [branch]    - Branch name.
 * @property {string} [url]       - Remote URL (for clone/addRemote).
 * @property {string} [corsProxy] - CORS proxy URL (browser backends only).
 * @property {() => { username: string, password: string }} [onAuth] - Auth callback.
 * @property {AbortSignal} [signal]
 */

/**
 * Git provider — query and mutate repository state.
 *
 * Read operations (required):
 * @typedef {Object} GitProvider
 * @property {(opts?: { signal?: AbortSignal }) => Promise<GitStatus>} status
 *   Get working-tree status.
 * @property {(path: string, opts?: { signal?: AbortSignal }) => Promise<string>} diff
 *   Get diff for a specific file.
 * @property {(path: string, opts?: { signal?: AbortSignal }) => Promise<string>} show
 *   Show HEAD version of a file.
 *
 * Write operations (optional — present when backend supports git mutations):
 * @property {(opts?: { signal?: AbortSignal }) => Promise<void>} [init]
 *   Initialize a new git repository.
 * @property {(paths: string[], opts?: { signal?: AbortSignal }) => Promise<void>} [add]
 *   Stage files.
 * @property {(message: string, opts?: { author?: GitAuthor, signal?: AbortSignal }) => Promise<{ oid: string }>} [commit]
 *   Create a commit with staged changes.
 * @property {(opts?: GitRemoteOpts) => Promise<void>} [push]
 *   Push to remote.
 * @property {(opts?: GitRemoteOpts & { author?: GitAuthor }) => Promise<void>} [pull]
 *   Pull from remote.
 * @property {(url: string, opts?: GitRemoteOpts) => Promise<void>} [clone]
 *   Clone a remote repository.
 * @property {(name: string, url: string, opts?: { signal?: AbortSignal }) => Promise<void>} [addRemote]
 *   Add or update a remote.
 * @property {(opts?: { signal?: AbortSignal }) => Promise<GitRemote[]>} [listRemotes]
 *   List configured remotes.
 */

/**
 * The unified DataProvider contract.
 * Adapters (HTTP, filesystem-backed, ...) implement this interface.
 *
 * Adapter requirements:
 * - Normalize git status codes to GitStatusCode values (M/U/A/D/C).
 * - Accept relative paths (no leading slash) from project root.
 * - Throw errors with actionable messages (include path, HTTP status, etc.).
 * - Respect the AbortSignal on all methods; abort in-flight work when signalled.
 *
 * @typedef {Object} DataProvider
 * @property {FilesProvider} files - Filesystem operations.
 * @property {GitProvider} git     - Git operations.
 * @property {(code: string, options?: { path?: string, cwd?: string }) => Promise<any>} [runPython]
 *   Optional Python execution runtime (used by PI `python_exec` tool).
 * @property {(command: string, options?: { cwd?: string, stream?: boolean }) => Promise<any>} [runCommand]
 *   Optional shell command runtime (used by PI `exec_bash` tool).
 */

export {}
