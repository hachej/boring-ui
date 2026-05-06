import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Input, Label } from '@hachej/boring-ui-kit
import { useResetPassword } from './AuthProvider.js'
import { routes } from '../utils.js'

const resetSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type ResetFormData = z.infer<typeof resetSchema>

export function ResetPasswordPage() {
  const resetPassword = useResetPassword()
  const [serverError, setServerError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [expired, setExpired] = useState(false)

  const token = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('token')
    : null

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetFormData>({
    resolver: zodResolver(resetSchema),
  })

  async function onSubmit(data: ResetFormData) {
    if (!token) {
      setExpired(true)
      return
    }
    setServerError(null)
    setIsSubmitting(true)
    try {
      const result = await resetPassword({ token, newPassword: data.password })
      if (result.error) {
        const status = result.error.status
        if (status === 410 || status === 400) {
          const msg = result.error.message?.toLowerCase() ?? ''
          if (msg.includes('expired') || msg.includes('invalid') || status === 410) {
            setExpired(true)
            return
          }
        }
        setServerError(result.error.message ?? 'Reset failed')
      } else {
        window.location.assign(routes.signin)
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!token || expired) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Link expired</CardTitle>
            <CardDescription>
              This reset link is no longer valid. Please request a new one.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <a href={routes.forgotPassword}>
              <Button variant="outline">Request new link</Button>
            </a>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Reset password</CardTitle>
          <CardDescription>Enter your new password below</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <CardContent className="space-y-4">
            {serverError && (
              <div role="alert" className="text-sm text-destructive">
                {serverError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm password</Label>
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
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Resetting…' : 'Reset password'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
