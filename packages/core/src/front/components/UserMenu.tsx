import { useMemo, useState } from 'react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@hachej/boring-ui-kit'
import {
  ChevronDown,
  Check,
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
          aria-label="User menu"
          className="h-8 rounded-md border border-transparent bg-transparent px-1 pr-1.5 text-foreground shadow-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-[11px] font-semibold text-background">
            {initials}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-80 rounded-lg border-border/70 bg-[color:var(--surface-workbench-left)] p-2 shadow-2xl"
      >
        <DropdownMenuLabel className="p-2">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background">
              {initials}
            </span>
            <span className="min-w-0 space-y-1">
              <span className="block truncate text-sm font-medium leading-none">{userName}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">{userEmail}</span>
            </span>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator className="-mx-2" />

        <DropdownMenuLabel className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
          Theme
        </DropdownMenuLabel>
        {THEME_ORDER.map((theme) => {
          const Icon = iconForTheme(theme)
          const selected = preference === theme
          return (
            <DropdownMenuItem
              key={theme}
              aria-label={labelForTheme(theme)}
              data-current={selected ? 'true' : 'false'}
              onSelect={(event: Event) => {
                event.preventDefault()
                setTheme(theme)
              }}
              className="gap-3 rounded-md py-2 text-[13px] focus:bg-foreground/[0.06] focus:text-foreground"
            >
              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1">{labelForTheme(theme)}</span>
              {selected ? <Check className="h-4 w-4 text-foreground" aria-hidden="true" /> : null}
            </DropdownMenuItem>
          )
        })}

        <DropdownMenuSeparator className="-mx-2" />

        <DropdownMenuItem
          aria-label="User settings"
          onSelect={() => navigate(routes.me)}
          className="gap-3 rounded-md py-2 text-[13px] focus:bg-foreground/[0.06] focus:text-foreground"
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
          <span className="flex min-w-0 flex-col">
            <span>User settings</span>
            <span className="text-xs text-muted-foreground">Password and account controls</span>
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="-mx-2" />

        <DropdownMenuItem
          variant="destructive"
          onSelect={(event: Event) => {
            event.preventDefault()
            void handleSignOut()
          }}
          disabled={isSigningOut}
          className="gap-3 rounded-md py-2 text-[13px]"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {isSigningOut ? 'Signing out...' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
