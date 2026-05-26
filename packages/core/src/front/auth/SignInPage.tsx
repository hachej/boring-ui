import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Input, Label } from '@hachej/boring-ui-kit'
import { useSignIn } from './AuthProvider.js'
import { GoogleAuthButton } from './GoogleAuthButton.js'
import { useOptionalConfig } from '../ConfigProvider.js'
import { routes } from '../utils.js'

const signInSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})

type SignInFormData = z.infer<typeof signInSchema>

const DEFAULT_GOOGLE_SIGNIN_ERROR = 'We could not complete Google sign in. Please try again or continue with email.'

function readGoogleAuthError(): string | null {
  if (typeof window === 'undefined') return null
  const error = new URLSearchParams(window.location.search).get('error')
  return error ? DEFAULT_GOOGLE_SIGNIN_ERROR : null
}

export function SignInPage() {
  const signIn = useSignIn()
  const config = useOptionalConfig()
  const [serverError, setServerError] = useState<string | null>(null)
  const [oauthError, setOauthError] = useState<string | null>(() => readGoogleAuthError())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const showGoogleAuth = config?.features.googleOauth === true

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInFormData>({
    resolver: zodResolver(signInSchema),
  })

  async function onSubmit(data: SignInFormData) {
    setServerError(null)
    setOauthError(null)
    setIsSubmitting(true)
    try {
      const result = await signIn.email({
        email: data.email,
        password: data.password,
      })
      if (result.error) {
        setServerError(result.error.message ?? 'Sign in failed')
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Enter your credentials to continue</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <CardContent className="space-y-4">
            {showGoogleAuth && (
              <>
                <GoogleAuthButton
                  errorCallbackURL={routes.signin}
                  onError={(message) => setOauthError(message || DEFAULT_GOOGLE_SIGNIN_ERROR)}
                />
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
                  </div>
                </div>
              </>
            )}
            {(serverError ?? oauthError) && (
              <div role="alert" className="text-sm text-destructive">
                {serverError ?? oauthError}
              </div>
            )}
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
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
            <div className="flex justify-between text-sm w-full">
              <a href={routes.forgotPassword} className="text-muted-foreground hover:underline">
                Forgot password?
              </a>
              <a href={routes.signup} className="text-muted-foreground hover:underline">
                Sign up
              </a>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
