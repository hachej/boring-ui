import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Input,
  Label,
} from '@boring/workspace/ui-shadcn'
import {
  CalendarDays,
  CheckCircle2,
  KeyRound,
  Mail,
  ShieldAlert,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useSession, useSignOut, useChangePassword } from './AuthProvider.js'
import { useUser } from './UserIdentityProvider.js'
import { apiFetch } from '../utils.js'

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type ChangePasswordData = z.infer<typeof changePasswordSchema>

export interface UserSettingsPageProps {
  topBar?: ReactNode
}

function initialsFor(name: string | null | undefined, email: string): string {
  const source = name?.trim() ? name : email
  return source
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function formatMemberSince(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function SettingsTopBar() {
  return (
    <header
      className="relative flex h-[52px] items-center justify-between gap-3 border-b border-border/40 bg-background px-4"
      aria-label="App top bar"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background"
        >
          B
        </div>
        <span className="truncate text-[13px] font-medium tracking-tight text-foreground">
          Boring
        </span>
        <span aria-hidden="true" className="text-muted-foreground/30">/</span>
        <span className="truncate text-[13px] text-muted-foreground">Account settings</span>
      </div>
    </header>
  )
}

function SettingsPanel({
  id,
  icon,
  title,
  description,
  children,
  footer,
  danger = false,
}: {
  id: string
  icon: ReactNode
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  danger?: boolean
}) {
  return (
    <section id={id} className="scroll-mt-6 overflow-hidden rounded-lg border border-border/60 bg-background shadow-none">
      <div className="flex min-h-11 items-center gap-2 border-b border-border/50 px-4 py-2.5">
        <span className={danger ? 'text-destructive' : 'text-muted-foreground'}>
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className={`text-[13px] font-medium leading-5 ${danger ? 'text-destructive' : 'text-foreground'}`}>
            {title}
          </h2>
          {description ? (
            <p className="text-[12px] leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      <div className="p-4">{children}</div>
      {footer ? (
        <div className="flex items-center justify-end gap-2 border-t border-border/50 bg-muted/10 px-4 py-3">
          {footer}
        </div>
      ) : null}
    </section>
  )
}

function SettingsNav({
  label,
  items,
}: {
  label: string
  items: Array<{ href: string; label: string; description: string }>
}) {
  return (
    <nav aria-label={`${label} sections`} className="boring-settings-nav">
      <p className="boring-settings-nav-label">{label}</p>
      {items.map((item) => (
        <a key={item.href} href={item.href} className="boring-settings-nav-item">
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-medium text-foreground">{item.label}</span>
            <span className="block truncate text-[11.5px] leading-4 text-muted-foreground">
              {item.description}
            </span>
          </span>
        </a>
      ))}
    </nav>
  )
}

function SettingsPageHeader({
  initials,
  displayName,
  email,
}: {
  initials: string
  displayName: string
  email: string
}) {
  return (
    <header className="boring-settings-page-header">
      <div className="boring-settings-context">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground">
            Signed in as {displayName}
          </p>
          <p className="truncate text-[12px] leading-5 text-muted-foreground">
            {email} account
          </p>
        </div>
      </div>
      <div className="max-w-2xl">
        <p className="text-[11px] font-medium uppercase leading-4 text-muted-foreground">Account</p>
        <h1 className="mt-1 text-[20px] font-semibold leading-7 tracking-tight text-foreground">
          Account settings
        </h1>
        <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
          Review your profile, change your password, and manage account-level actions.
        </p>
      </div>
    </header>
  )
}

function DetailLine({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-12 items-center gap-3 px-3 py-2 text-[13px]">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground">
        {icon}
      </span>
      <dt className="w-32 shrink-0 text-[12px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-foreground">{children}</dd>
    </div>
  )
}

function ActionRow({
  title,
  description,
  action,
}: {
  title: string
  description: ReactNode
  action: ReactNode
}) {
  return (
    <div className="boring-settings-action-row">
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-5 text-foreground">{title}</p>
        <p className="mt-1 max-w-xl text-[12px] leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

function StatusMessage({
  tone,
  children,
}: {
  tone: 'error' | 'success'
  children: ReactNode
}) {
  const className =
    tone === 'error'
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-3 py-2 text-[13px] leading-5 ${className}`}
    >
      {children}
    </div>
  )
}

const ACCOUNT_NAV_ITEMS = [
  { href: '#profile', label: 'Profile', description: 'Identity and email' },
  { href: '#password', label: 'Password', description: 'Sign-in security' },
  { href: '#danger-zone', label: 'Deletion', description: 'Permanent actions' },
]

export function UserSettingsPage({ topBar }: UserSettingsPageProps = {}) {
  const session = useSession()
  const identity = useUser()
  const signOut = useSignOut()
  const changePassword = useChangePassword()

  const user = identity?.user ?? session.data?.user ?? null

  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)

  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
  } = useForm<ChangePasswordData>({
    resolver: zodResolver(changePasswordSchema),
  })

  const onChangePassword = useCallback(
    async (data: ChangePasswordData) => {
      setPasswordError(null)
      setPasswordSuccess(false)
      setIsChangingPassword(true)
      try {
        const result = await changePassword({
          currentPassword: data.currentPassword,
          newPassword: data.newPassword,
          revokeOtherSessions: true,
        })
        if (result.error) {
          setPasswordError(result.error.message ?? 'Failed to change password')
        } else {
          setPasswordSuccess(true)
          resetForm()
        }
      } catch (err) {
        setPasswordError(err instanceof Error ? err.message : 'Failed to change password')
      } finally {
        setIsChangingPassword(false)
      }
    },
    [changePassword, resetForm],
  )

  const onDeleteAccount = useCallback(async () => {
    if (!user?.email) return
    setDeleteError(null)
    setIsDeleting(true)
    try {
      await apiFetch('/api/v1/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: user.email }),
      })
      await signOut()
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to delete account'
      if (message.includes('sole owner') || message.includes('last_owner')) {
        setDeleteError(
          'You are the sole owner of one or more workspaces. Transfer ownership or delete those workspaces first.',
        )
      } else {
        setDeleteError(message)
      }
    } finally {
      setIsDeleting(false)
    }
  }, [user?.email, signOut])

  const topBarNode = topBar === undefined ? <SettingsTopBar /> : topBar

  if (!user) {
    return (
      <main className="boring-settings-shell">
        {topBarNode}
        <div className="boring-settings-scroll">
          <div className="mx-auto flex min-h-full w-full max-w-5xl items-center justify-center px-4">
            <div className="w-full max-w-sm rounded-lg border border-border/60 bg-background p-4">
              <h1 className="text-[13px] font-medium">Account settings</h1>
              <p className="mt-1 text-[12px] text-muted-foreground">Loading your account...</p>
            </div>
          </div>
        </div>
      </main>
    )
  }

  const initials = initialsFor(user.name, user.email)

  return (
    <main className="boring-settings-shell">
      {topBarNode}
      <div className="boring-settings-scroll">
        <div className="boring-settings-layout">
          <aside className="boring-settings-sidebar">
            <SettingsNav label="Account settings" items={ACCOUNT_NAV_ITEMS} />
          </aside>

          <div className="boring-settings-content space-y-4">
            <SettingsPageHeader
              initials={initials}
              displayName={user.name ?? user.email}
              email={user.email}
            />
          <SettingsPanel
            id="profile"
            icon={<UserRound className="h-3.5 w-3.5" aria-hidden="true" />}
            title="Profile"
            description="The identity shown inside this app."
          >
            <dl className="divide-y divide-border/50 rounded-md border border-border/50 bg-muted/10">
              <DetailLine
                icon={<Mail className="h-3.5 w-3.5" aria-hidden="true" />}
                label="Email"
              >
                <p className="truncate">{user.email}</p>
              </DetailLine>
              <DetailLine
                icon={<UserRound className="h-3.5 w-3.5" aria-hidden="true" />}
                label="Name"
              >
                <p className="truncate">{user.name ?? 'Not set'}</p>
              </DetailLine>
              <DetailLine
                icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />}
                label="Member since"
              >
                <p>{formatMemberSince(user.createdAt)}</p>
              </DetailLine>
              <DetailLine
                icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                label="Email status"
              >
                <p>{user.emailVerified ? 'Verified' : 'Not verified'}</p>
              </DetailLine>
            </dl>
          </SettingsPanel>

          <form onSubmit={handleSubmit(onChangePassword)} noValidate>
            <SettingsPanel
              id="password"
              icon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
              title="Change password"
              description="Update the password used for email sign-in."
              footer={(
                <Button type="submit" size="sm" disabled={isChangingPassword}>
                  {isChangingPassword ? 'Changing...' : 'Change password'}
                </Button>
              )}
            >
              <div className="space-y-4">
                {passwordError && <StatusMessage tone="error">{passwordError}</StatusMessage>}
                {passwordSuccess && (
                  <StatusMessage tone="success">Password changed successfully.</StatusMessage>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="currentPassword" className="text-[12px]">Current password</Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      className="h-8 text-[13px]"
                      autoComplete="current-password"
                      aria-invalid={errors.currentPassword ? 'true' : 'false'}
                      {...register('currentPassword')}
                    />
                    {errors.currentPassword && (
                      <p className="text-[12px] text-destructive">{errors.currentPassword.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="newPassword" className="text-[12px]">New password</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      className="h-8 text-[13px]"
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      aria-invalid={errors.newPassword ? 'true' : 'false'}
                      {...register('newPassword')}
                    />
                    {errors.newPassword && (
                      <p className="text-[12px] text-destructive">{errors.newPassword.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword" className="text-[12px]">Confirm new password</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      className="h-8 text-[13px]"
                      autoComplete="new-password"
                      aria-invalid={errors.confirmPassword ? 'true' : 'false'}
                      {...register('confirmPassword')}
                    />
                    {errors.confirmPassword && (
                      <p className="text-[12px] text-destructive">{errors.confirmPassword.message}</p>
                    )}
                  </div>
                </div>
              </div>
            </SettingsPanel>
          </form>

          <SettingsPanel
            id="danger-zone"
            icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}
            title="Danger zone"
            description="Permanently delete this account and remove its workspace access."
            danger
          >
            <ActionRow
              title="Delete account"
              description="Delete your account, user settings, and workspace memberships after confirmation."
              action={(
              <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete account
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. All your data, workspaces, and
                      settings will be permanently deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-3 py-2">
                    {deleteError && <StatusMessage tone="error">{deleteError}</StatusMessage>}
                    <div className="space-y-2">
                      <Label htmlFor="delete-confirm">
                        Type <span className="font-mono font-bold">DELETE</span> to confirm
                      </Label>
                      <Input
                        id="delete-confirm"
                        className="h-8 text-[13px]"
                        value={deleteConfirm}
                        onChange={(e) => setDeleteConfirm(e.target.value)}
                        placeholder="DELETE"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel
                      onClick={() => {
                        setDeleteConfirm('')
                        setDeleteError(null)
                      }}
                    >
                      Cancel
                    </AlertDialogCancel>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deleteConfirm !== 'DELETE' || isDeleting}
                      onClick={onDeleteAccount}
                    >
                      {isDeleting ? 'Deleting...' : 'Delete my account'}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              )}
            />
          </SettingsPanel>
          </div>
        </div>
      </div>
    </main>
  )
}
