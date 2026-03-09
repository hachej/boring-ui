import { createContext, useContext } from 'react'

const UserIdentityContext = createContext({ userId: '', authResolved: true })

export const UserIdentityProvider = UserIdentityContext.Provider

export const useUserIdentity = () => useContext(UserIdentityContext)
