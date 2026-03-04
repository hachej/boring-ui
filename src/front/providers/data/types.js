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
 * - 'C' = copied
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
 * Git provider — query repository state.
 *
 * @typedef {Object} GitProvider
 * @property {(opts?: { signal?: AbortSignal }) => Promise<GitStatus>} status
 *   Get working-tree status.
 * @property {(path: string, opts?: { signal?: AbortSignal }) => Promise<string>} diff
 *   Get diff for a specific file.
 * @property {(path: string, opts?: { signal?: AbortSignal }) => Promise<string>} show
 *   Show HEAD version of a file.
 */

/**
 * The unified DataProvider contract.
 * Adapters (HTTP, filesystem, CheerpX, ...) implement this interface.
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
 */

export {}
