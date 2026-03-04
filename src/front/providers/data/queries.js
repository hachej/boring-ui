import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useDataProvider } from './DataContext'

// ---------------------------------------------------------------------------
// Query-key factory — single source of truth for all cache keys
// ---------------------------------------------------------------------------

export const queryKeys = {
  files: {
    all: ['files'],
    lists: () => [...queryKeys.files.all, 'list'],
    list: (dir) => [...queryKeys.files.lists(), dir],
    reads: () => [...queryKeys.files.all, 'read'],
    read: (path) => [...queryKeys.files.reads(), path],
    searches: () => [...queryKeys.files.all, 'search'],
    search: (query) => [...queryKeys.files.searches(), query],
  },
  git: {
    all: ['git'],
    status: () => [...queryKeys.git.all, 'status'],
    diffs: () => [...queryKeys.git.all, 'diff'],
    diff: (path) => [...queryKeys.git.diffs(), path],
    shows: () => [...queryKeys.git.all, 'show'],
    show: (path) => [...queryKeys.git.shows(), path],
  },
}

// ---------------------------------------------------------------------------
// File query hooks
// ---------------------------------------------------------------------------

/**
 * List directory contents.
 * @param {string} dir - Directory path relative to project root.
 * @param {import('@tanstack/react-query').UseQueryOptions} [options]
 */
export const useFileList = (dir, options = {}) => {
  const provider = useDataProvider()
  return useQuery({
    queryKey: queryKeys.files.list(dir),
    queryFn: ({ signal }) => provider.files.list(dir, { signal }),
    enabled: dir != null,
    ...options,
  })
}

/**
 * Read a single file's content.
 * @param {string} path - File path relative to project root.
 * @param {import('@tanstack/react-query').UseQueryOptions} [options]
 */
export const useFileContent = (path, options = {}) => {
  const provider = useDataProvider()
  return useQuery({
    queryKey: queryKeys.files.read(path),
    queryFn: ({ signal }) => provider.files.read(path, { signal }),
    enabled: path != null,
    ...options,
  })
}

/**
 * Search files.
 * @param {string} query - Search term.
 * @param {import('@tanstack/react-query').UseQueryOptions} [options]
 */
export const useFileSearch = (query, options = {}) => {
  const provider = useDataProvider()
  return useQuery({
    queryKey: queryKeys.files.search(query),
    queryFn: ({ signal }) => provider.files.search(query, { signal }),
    enabled: !!query,
    ...options,
  })
}

// ---------------------------------------------------------------------------
// File mutation hooks
// ---------------------------------------------------------------------------

/**
 * Write (create/overwrite) a file.
 * Optimistically cancels in-flight reads for the same path and invalidates
 * relevant queries on success.
 */
export const useFileWrite = () => {
  const provider = useDataProvider()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path, content }) => provider.files.write(path, content),
    onMutate: async ({ path, content }) => {
      const readKey = queryKeys.files.read(path)
      // Cancel any in-flight read queries for this file so stale data
      // doesn't overwrite the about-to-be-saved version.
      await qc.cancelQueries({ queryKey: readKey })

      const previousContent = qc.getQueryData(readKey)
      const hadPreviousContent = qc.getQueryState(readKey)?.data !== undefined

      // Optimistically reflect saved content to prevent transient stale reads
      // (for example, editor "changed on disk" flashes right after autosave).
      qc.setQueryData(readKey, content)

      return { readKey, previousContent, hadPreviousContent }
    },
    onError: (_error, _variables, context) => {
      if (!context?.readKey) return
      if (context.hadPreviousContent) {
        qc.setQueryData(context.readKey, context.previousContent)
        return
      }
      qc.removeQueries({ queryKey: context.readKey, exact: true })
    },
    onSuccess: (_data, { path }) => {
      // Invalidate the file content cache and parent directory listing.
      qc.invalidateQueries({ queryKey: queryKeys.files.read(path) })
      qc.invalidateQueries({ queryKey: queryKeys.files.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.git.all })
    },
  })
}

/**
 * Delete a file.
 */
export const useFileDelete = () => {
  const provider = useDataProvider()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ path }) => provider.files.delete(path),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.files.all })
      qc.invalidateQueries({ queryKey: queryKeys.git.all })
    },
  })
}

/**
 * Rename a file (same directory, new name).
 */
export const useFileRename = () => {
  const provider = useDataProvider()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ oldPath, newName }) => provider.files.rename(oldPath, newName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.files.all })
      qc.invalidateQueries({ queryKey: queryKeys.git.all })
    },
  })
}

/**
 * Move a file to a different location.
 */
export const useFileMove = () => {
  const provider = useDataProvider()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ srcPath, destPath }) => provider.files.move(srcPath, destPath),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.files.all })
      qc.invalidateQueries({ queryKey: queryKeys.git.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Git query hooks
// ---------------------------------------------------------------------------

/**
 * Working-tree git status.
 * @param {import('@tanstack/react-query').UseQueryOptions} [options]
 */
export const useGitStatus = (options = {}) => {
  const provider = useDataProvider()
  return useQuery({
    queryKey: queryKeys.git.status(),
    queryFn: ({ signal }) => provider.git.status({ signal }),
    ...options,
  })
}

/**
 * Diff for a specific file.
 * @param {string} path
 * @param {import('@tanstack/react-query').UseQueryOptions} [options]
 */
export const useGitDiff = (path, options = {}) => {
  const provider = useDataProvider()
  return useQuery({
    queryKey: queryKeys.git.diff(path),
    queryFn: ({ signal }) => provider.git.diff(path, { signal }),
    enabled: path != null,
    ...options,
  })
}

/**
 * Show HEAD version of a file.
 * @param {string} path
 * @param {import('@tanstack/react-query').UseQueryOptions} [options]
 */
export const useGitShow = (path, options = {}) => {
  const provider = useDataProvider()
  return useQuery({
    queryKey: queryKeys.git.show(path),
    queryFn: ({ signal }) => provider.git.show(path, { signal }),
    enabled: path != null,
    ...options,
  })
}
