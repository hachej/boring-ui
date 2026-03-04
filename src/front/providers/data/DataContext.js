import { createContext, useContext } from 'react'

/**
 * React context carrying the active DataProvider instance.
 * @type {import('react').Context<import('./types').DataProvider | null>}
 */
const DataContext = createContext(null)

/**
 * Return the current DataProvider from context.
 * Throws if used outside of a DataProviderWrapper.
 *
 * @returns {import('./types').DataProvider}
 */
export const useDataProvider = () => {
  const provider = useContext(DataContext)
  if (!provider) {
    throw new Error('useDataProvider must be used within a DataProviderWrapper')
  }
  return provider
}

export default DataContext
