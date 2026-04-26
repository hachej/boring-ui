import { useCallback, useState } from 'react'
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
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Separator,
} from '@boring/workspace/ui-shadcn'
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

export function UserSettingsPage() {
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

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Account settings</CardTitle>
            <CardDescription>Loading your account…</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Profile info */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Email</Label>
              <p className="text-sm">{user.email}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Name</Label>
              <p className="text-sm">{user.name ?? '—'}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Member since</Label>
              <p className="text-sm">
                {new Date(user.createdAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Change password */}
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>Update your account password</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit(onChangePassword)} noValidate>
            <CardContent className="space-y-4">
              {passwordError && (
                <div role="alert" className="text-sm text-destructive">
                  {passwordError}
                </div>
              )}
              {passwordSuccess && (
                <div role="status" className="text-sm text-green-600 dark:text-green-400">
                  Password changed successfully.
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  {...register('currentPassword')}
                />
                {errors.currentPassword && (
                  <p className="text-sm text-destructive">{errors.currentPassword.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  {...register('newPassword')}
                />
                {errors.newPassword && (
                  <p className="text-sm text-destructive">{errors.newPassword.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  {...register('confirmPassword')}
                />
                {errors.confirmPassword && (
                  <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={isChangingPassword}>
                {isChangingPassword ? 'Changing…' : 'Change password'}
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* Danger zone */}
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>
              Permanently delete your account and all associated data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Separator className="mb-4" />
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="w-full">
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
                <div className="space-y-2 py-2">
                  {deleteError && (
                    <div role="alert" className="text-sm text-destructive">
                      {deleteError}
                    </div>
                  )}
                  <Label htmlFor="delete-confirm">
                    Type <span className="font-mono font-bold">DELETE</span> to confirm
                  </Label>
                  <Input
                    id="delete-confirm"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder="DELETE"
                    autoComplete="off"
                  />
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
                    disabled={deleteConfirm !== 'DELETE' || isDeleting}
                    onClick={onDeleteAccount}
                  >
                    {isDeleting ? 'Deleting…' : 'Delete my account'}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
