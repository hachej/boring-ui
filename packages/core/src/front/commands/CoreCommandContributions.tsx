import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useSignOut } from '../auth/index.js'
import { useCurrentWorkspace } from '../WorkspaceAuthProvider.js'
import { routes } from '../utils.js'
import { getWorkspaceCommands } from '../workspace/commands.js'

export interface CoreCommand {
  id: string
  title: string
  run: () => void
  keywords?: string[]
  shortcut?: string
  when?: () => boolean
  pluginId?: string
}

const CORE_COMMAND_SOURCE = 'core'

function toPaletteCommand(command: ReturnType<typeof getWorkspaceCommands>[number]): CoreCommand {
  return {
    id: command.id,
    title: command.label,
    keywords: command.keywords,
    run: command.run,
    pluginId: CORE_COMMAND_SOURCE,
  }
}

export function useCoreCommands(): CoreCommand[] {
  const navigate = useNavigate()
  const signOut = useSignOut()
  const workspace = useCurrentWorkspace()
  const [isSigningOut, setIsSigningOut] = useState(false)

  return useMemo<CoreCommand[]>(() => {
    const result: CoreCommand[] = [
      {
        id: 'user:settings',
        title: 'Account settings',
        keywords: ['user', 'profile', 'settings', 'account', 'me'],
        pluginId: CORE_COMMAND_SOURCE,
        run: () => navigate(routes.me),
      },
      {
        id: 'auth:sign-out',
        title: 'Sign out',
        keywords: ['logout', 'log out', 'auth', 'user'],
        pluginId: CORE_COMMAND_SOURCE,
        when: () => !isSigningOut,
        run: () => {
          if (isSigningOut) return
          setIsSigningOut(true)
          void signOut().finally(() => {
            setIsSigningOut(false)
            navigate(routes.signin)
          })
        },
      },
    ]

    if (workspace?.id) {
      result.push(...getWorkspaceCommands(workspace.id, navigate).map(toPaletteCommand))
    }

    return result
  }, [isSigningOut, navigate, signOut, workspace?.id])
}
