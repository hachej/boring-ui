import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Input, Label } from '@hachej/boring-ui-kit'
import { useSignUp } from './AuthProvider.js'
import { GoogleAuthButton } from './GoogleAuthButton.js'
import { isRuntimeEmailVerificationEnabled } from '../../shared/authPolicy.js'
import { useOptionalConfig } from '../ConfigProvider.js'
import { routes } from '../utils.js'

const signUpSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

type SignUpFormData = z.infer<typeof signUpSchema>

const DEFAULT_GOOGLE_SIGNUP_ERROR = 'We could not complete Google sign up. Please try again or continue with email.'

function readGoogleAuthError(): string | null {
  if (typeof window === 'undefined') return null
  const error = new URLSearchParams(window.location.search).get('error')
  return error ? DEFAULT_GOOGLE_SIGNUP_ERROR : null
}

function readSignUpParams(): { inviteToken: string | null; claim: boolean; callbackURL: string } {
  if (typeof window === 'undefined') return { inviteToken: null, claim: false, callbackURL: '/' }
  const params = new URLSearchParams(window.location.search)
  const callbackURL = params.get('callbackURL') ?? '/'
  return {
    inviteToken: params.get('invite_token'),
    claim: params.get('claim') === '1',
    callbackURL: callbackURL.startsWith('/') && !callbackURL.startsWith('//') ? callbackURL : '/',
  }
}

export function SignUpPage() {
  const signUp = useSignUp()
  const navigate = useNavigate()
  const config = useOptionalConfig()
  const [serverError, setServerError] = useState<string | null>(null)
  const [oauthError, setOauthError] = useState<string | null>(() => readGoogleAuthError())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const { inviteToken, claim, callbackURL } = readSignUpParams()
  const showGoogleAuth = config?.features.googleOauth === true && !inviteToken

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpFormData>({
    resolver: zodResolver(signUpSchema),
  })

  async function onSubmit(data: SignUpFormData) {
    setServerError(null)
    setOauthError(null)
    setIsSubmitting(true)
    try {
      const fetchOptions = inviteToken
        ? { headers: { 'x-invite-token': inviteToken } }
        : undefined

      const result = await signUp.email(
        { email: data.email, password: data.password, name: data.name },
        fetchOptions,
      )
      if (result.error) {
        setServerError(result.error.message ?? 'Sign up failed')
      } else if (isRuntimeEmailVerificationEnabled(config)) {
        navigate(routes.verifyEmail, { replace: true })
      } else if (claim) {
        navigate(callbackURL, { replace: true })
      } else {
        setSuccess(true)
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Sign up failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Check your email</CardTitle>
            <CardDescription>
              We sent a verification link to your email address. Please check your inbox to continue.
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
          <CardTitle>{claim ? 'Save your account' : 'Create an account'}</CardTitle>
          <CardDescription>
            {claim
              ? 'Create an account to keep your workspace, credits, and history.'
              : 'Enter your details to get started'}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <CardContent className="space-y-4">
            {showGoogleAuth && (
              <>
                <GoogleAuthButton
                  errorCallbackURL={routes.signup}
                  onError={(message) => setOauthError(message || DEFAULT_GOOGLE_SIGNUP_ERROR)}
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
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                autoComplete="name"
                placeholder="Your name"
                {...register('name')}
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>
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
                autoComplete="new-password"
                placeholder="At least 8 characters"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account…' : 'Sign up'}
            </Button>
            <div className="text-sm text-center">
              <span className="text-muted-foreground">Already have an account? </span>
              <a href={routes.signin} className="hover:underline">
                Sign in
              </a>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
