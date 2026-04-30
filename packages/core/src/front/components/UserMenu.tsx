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
import {
  LogOut,
  Monitor,
  Moon,
  Settings,
  Sun,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useSignOut, useUser } from '../auth/index.js'
import { useTheme } from '../hooks/index.js'
import { routes } from '../utils.js'

type ThemePreference = 'light' | 'dark' | 'system'

const THEME_ORDER: ThemePreference[] = ['light', 'dark', 'system']

function nextTheme(preference: ThemePreference): ThemePreference {
  const index = THEME_ORDER.indexOf(preference)
  const nextIndex = index === -1 ? 0 : (index + 1) % THEME_ORDER.length
  return THEME_ORDER[nextIndex]
}

function labelForTheme(preference: ThemePreference): string {
  if (preference === 'light') return 'Light'
  if (preference === 'dark') return 'Dark'
  return 'System'
}

function iconForTheme(preference: ThemePreference) {
  if (preference === 'light') return Sun
  if (preference === 'dark') return Moon
  return Monitor
}

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
  const { preference, setTheme } = useTheme()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const user = identity?.user

  const userName = user?.name ?? 'Unknown user'
  const userEmail = user?.email ?? 'unknown@example.com'
  const initials = useMemo(() => initialsFor(user?.name ?? null, userEmail), [user?.name, userEmail])
  const themeLabel = labelForTheme(preference)
  const ThemeIcon = iconForTheme(preference)

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
          variant="ghost"
          size="icon-sm"
          aria-label="User menu"
          className="rounded-full border border-[color:oklch(0.68_0.12_58/0.45)] bg-[oklch(0.76_0.15_58)]/10 text-foreground hover:bg-[oklch(0.76_0.15_58)]/18"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[oklch(0.76_0.15_58)] text-[11px] font-semibold text-[oklch(0.18_0.04_58)] shadow-[inset_0_0_0_1px_oklch(1_0_0/0.2)]">
            {initials}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="space-y-1.5 px-2 py-2">
          <p className="truncate text-sm font-medium leading-none">{userName}</p>
          <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={(event: any) => {
            event.preventDefault()
            setTheme(nextTheme(preference))
          }}
          aria-label={`Theme: ${themeLabel}`}
          className="justify-between"
        >
          <span className="inline-flex items-center gap-2">
            <ThemeIcon className="h-4 w-4" aria-hidden="true" />
            <span>Theme: {themeLabel}</span>
          </span>
          <span
            aria-hidden="true"
            data-theme-preference={preference}
            className="relative inline-flex h-[18px] w-[34px] items-center rounded-full border border-border bg-muted data-[theme-preference=dark]:bg-primary data-[theme-preference=light]:bg-primary/35"
          >
            <span className="h-3 w-3 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform data-[theme-preference=dark]:translate-x-[18px]" data-theme-preference={preference} />
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => navigate(routes.me)}>
          <Settings className="h-4 w-4" aria-hidden="true" />
          User settings
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={(event: any) => {
            event.preventDefault()
            void handleSignOut()
          }}
          disabled={isSigningOut}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
