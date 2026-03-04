/**
 * Public API for the DataProvider infrastructure.
 *
 * @module providers/data
 */

// Module singletons (safe to call before React mount)
export { getQueryClient } from './queryClient'
export {
  setDataProvider,
  getDataProvider,
  registerDataProviderFactory,
  getDataProviderFactory,
} from './providerState'

// React context hook
export { useDataProvider } from './DataContext'
export { default as DataContext } from './DataContext'

// Query-key factory
export { queryKeys } from './queries'

// Query & mutation hooks
export {
  useFileList,
  useFileContent,
  useFileSearch,
  useFileWrite,
  useFileDelete,
  useFileRename,
  useFileMove,
  useGitStatus,
  useGitDiff,
  useGitShow,
} from './queries'

// HTTP provider factory
export { createHttpProvider } from './httpProvider'
