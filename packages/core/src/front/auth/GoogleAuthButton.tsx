import { useState } from 'react'
import { Button } from '@hachej/boring-ui-kit'
import { useSignIn } from './AuthProvider.js'

export interface GoogleAuthButtonProps {
  callbackURL?: string
  errorCallbackURL?: string
  onError?: (message?: string) => void
}

export function GoogleAuthButton({
  callbackURL = '/',
  errorCallbackURL = callbackURL,
  onError,
}: GoogleAuthButtonProps) {
  const signIn = useSignIn()
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleClick() {
    setIsSubmitting(true)
    try {
      const result = await signIn.social({ provider: 'google', callbackURL, errorCallbackURL })
      if (result?.error) {
        onError?.(result.error.message)
      }
    } catch (error) {
      onError?.(error instanceof Error ? error.message : undefined)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={isSubmitting}
      onClick={() => void handleClick()}
    >
      {isSubmitting ? 'Redirecting…' : 'Continue with Google'}
    </Button>
  )
}
