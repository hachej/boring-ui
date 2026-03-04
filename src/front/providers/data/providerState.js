/**
 * Module-level DataProvider singleton.
 *
 * poc1/poc2 entry-points call setDataProvider() *before* React mounts so that
 * the DataProviderWrapper in App.jsx picks up the custom adapter instead of
 * falling back to httpProvider.
 *
 * @type {import('./types').DataProvider | null}
 */
let provider = null
/**
 * Named DataProvider factory registry.
 * Host applications can register provider factories (e.g. lightningfs, cheerpx)
 * and select one via config.data.backend.
 *
 * @type {Map<string, () => import('./types').DataProvider>}
 */
const providerFactories = new Map()

/**
 * Store a DataProvider for later consumption by the React tree.
 * Must be called before ReactDOM.createRoot().render().
 *
 * @param {import('./types').DataProvider} p
 */
export const setDataProvider = (p) => {
  provider = p
}

/**
 * Retrieve the current DataProvider (may be null).
 * @returns {import('./types').DataProvider | null}
 */
export const getDataProvider = () => provider

/**
 * Register a named DataProvider factory.
 *
 * @param {string} name
 * @param {() => import('./types').DataProvider} factory
 */
export const registerDataProviderFactory = (name, factory) => {
  const key = String(name || '').trim().toLowerCase()
  if (!key) throw new Error('registerDataProviderFactory: name is required')
  if (typeof factory !== 'function') {
    throw new Error(`registerDataProviderFactory(${key}): factory must be a function`)
  }
  providerFactories.set(key, factory)
}

/**
 * Get a named DataProvider factory.
 *
 * @param {string} name
 * @returns {(() => import('./types').DataProvider) | null}
 */
export const getDataProviderFactory = (name) => {
  const key = String(name || '').trim().toLowerCase()
  if (!key) return null
  return providerFactories.get(key) || null
}
