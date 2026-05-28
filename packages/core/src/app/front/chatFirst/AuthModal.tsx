import { AuthCard } from './AuthCard.js'

export function AuthModal({ onClose, returnTo }: { onClose: () => void; returnTo: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <AuthCard returnTo={returnTo} onClose={onClose} />
    </div>
  )
}
