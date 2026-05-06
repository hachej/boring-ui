import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Input, Label } from '@hachej/boring-ui-kit
import { useForgetPassword } from './AuthProvider.js'
import { routes } from '../utils.js'

const forgotSchema = z.object({
  email: z.string().email('Please enter a valid email'),
})

type ForgotFormData = z.infer<typeof forgotSchema>

export function ForgotPasswordPage() {
  const forgetPassword = useForgetPassword()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotFormData>({
    resolver: zodResolver(forgotSchema),
  })

  async function onSubmit(data: ForgotFormData) {
    setIsSubmitting(true)
    try {
      await forgetPassword({ email: data.email, redirectTo: routes.resetPassword })
    } catch {
      // Always show success to avoid account enumeration
    } finally {
      setIsSubmitting(false)
      setSubmitted(true)
    }
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Check your inbox</CardTitle>
            <CardDescription>
              If an account exists with that email, we sent a password reset link. Check your inbox and follow the instructions.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <a href={routes.signin} className="text-sm text-muted-foreground hover:underline">
              Back to sign in
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
          <CardTitle>Forgot password</CardTitle>
          <CardDescription>
            Enter your email and we'll send you a reset link
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                {...register('email')}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Sending…' : 'Send reset link'}
            </Button>
            <a href={routes.signin} className="text-sm text-muted-foreground hover:underline">
              Back to sign in
            </a>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
