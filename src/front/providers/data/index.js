/**
 * Public API for the DataProvider infrastructure.
 *
 * @module providers/data
 */

// Module singletons (safe to call before React mount)
export { createQueryClient, getQueryClient } from './queryClient'
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
  useGitInit,
  useGitAdd,
  useGitCommit,
  useGitPush,
  useGitPull,
  useGitClone,
  useGitAddRemote,
  useGitRemotes,
  useGitSync,
} from './queries'

// Auto-sync engine
export { createAutoSyncEngine, performSyncCycle } from './autoSync'

// Provider factories
export { createHttpProvider } from './httpProvider'
export { createLightningFsProvider } from './lightningFsProvider'
export { createLightningDataProvider } from './lightningDataProvider'
export { createCheerpXDataProvider } from './cheerpxDataProvider'
export { createIsomorphicGitProvider } from './isomorphicGitProvider'
export { createPyodidePythonRunner, loadPyodideRuntime } from './pyodideRunner'
export {
  createCheerpXRuntime,
  CheerpXRuntime,
  resolveWorkspacePath as resolveCheerpXWorkspacePath,
  toRelativeWorkspacePath as toRelativeCheerpXPath,
} from './cheerpxRuntime'

// Shared LightningFS instance (for direct access if needed)
export { fs as lightningFs, pfs as lightningPfs } from './lightningFs'
