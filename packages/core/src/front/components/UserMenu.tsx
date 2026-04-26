import { useMemo, useState } from 'react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@boring/workspace/ui-shadcn'
import { useNavigate } from 'react-router-dom'

import { useSignOut, useUser } from '../auth/index.js'
import { routes } from '../utils.js'

function initialsFor(name: string | null, email: string): string {
  if (name && name.trim().length > 0) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('')
  }

  return email.slice(0, 2).toUpperCase()
}

export function UserMenu() {
  const identity = useUser()
  const signOut = useSignOut()
  const navigate = useNavigate()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const user = identity?.user

  const userName = user?.name ?? 'Unknown user'
  const userEmail = user?.email ?? 'unknown@example.com'
  const initials = useMemo(() => initialsFor(user?.name ?? null, userEmail), [user?.name, userEmail])

  async function handleSignOut(): Promise<void> {
    if (isSigningOut) return
    setIsSigningOut(true)
    try {
      await signOut()
    } finally {
      setIsSigningOut(false)
      navigate(routes.signin)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="User menu"
          className="rounded-full"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
            {initials}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="space-y-1">
          <p className="text-sm font-medium leading-none">{userName}</p>
          <p className="text-xs text-muted-foreground">{userEmail}</p>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => navigate(routes.me)}
        >
          Settings
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={(event: any) => {
            event.preventDefault()
            void handleSignOut()
          }}
          disabled={isSigningOut}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
