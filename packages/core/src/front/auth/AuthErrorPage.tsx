import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@hachej/boring-ui-kit'
import { routes } from '../utils.js'

function readAuthErrorCode(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('error')
}

export function AuthErrorPage() {
  const errorCode = readAuthErrorCode()

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Authentication error</CardTitle>
          <CardDescription>
            We could not complete that authentication flow. Please try again.
          </CardDescription>
        </CardHeader>
        {errorCode && (
          <CardContent>
            <p className="text-sm text-muted-foreground break-all">Error: {errorCode}</p>
          </CardContent>
        )}
        <CardFooter className="flex justify-between gap-4 text-sm">
          <a href={routes.signin} className="text-muted-foreground hover:underline">
            Back to sign in
          </a>
          <a href={routes.signup} className="text-muted-foreground hover:underline">
            Create account
          </a>
        </CardFooter>
      </Card>
    </div>
  )
}
