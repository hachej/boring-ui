import type { StageSheet } from '../shared/stage.js'

export interface StageProps {
  /** The user's app. Always mounted, never unmounted — a sheet covers it. */
  readonly baseUrl: string
  readonly sheet: StageSheet | null
  /** Optional local dismiss; the agent normally closes the sheet with back_to_app. */
  readonly onBackToApp?: () => void
  /** The base iframe has content, so the phone can yield the screen to the app. */
  readonly onBaseReady?: () => void
}

/**
 * Two layers: the app, and at most one sheet over it. The base iframe is never
 * torn down, so closing a sheet returns the user to exactly the app state they
 * left — no reload, no lost scroll position.
 */
export function Stage({ baseUrl, sheet, onBackToApp, onBaseReady }: StageProps) {
  return (
    <div className="relative min-h-0 min-w-0 bg-muted/30" data-testid="one-chat-stage">
      <iframe
        src={baseUrl}
        title="Your app"
        data-testid="one-chat-base"
        className="absolute inset-0 size-full border-0 bg-background"
        onLoad={onBaseReady}
      />
      {sheet ? (
        <div
          className="absolute inset-0 flex flex-col bg-background"
          role="dialog"
          aria-label={sheet.title}
          data-testid="one-chat-sheet"
        >
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border/60 px-4">
            <span className="truncate text-[13px] font-medium text-foreground">{sheet.title}</span>
            <button
              type="button"
              onClick={onBackToApp}
              className="ml-auto min-h-11 rounded-md border border-border/60 px-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              data-testid="one-chat-back"
            >
              Back to my app
            </button>
          </div>
          <iframe
            src={sheet.url}
            title={sheet.title}
            data-testid="one-chat-sheet-frame"
            className="min-h-0 flex-1 border-0 bg-background"
          />
        </div>
      ) : null}
    </div>
  )
}
