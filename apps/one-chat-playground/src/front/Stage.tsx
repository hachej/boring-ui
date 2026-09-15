import type { StageScreen } from '../shared/stage.js'

export interface StageProps {
  readonly screen: StageScreen
  readonly onReady?: () => void
}

/** The colleague owns this surface. A new command replaces the single iframe. */
export function Stage({ screen, onReady }: StageProps) {
  return (
    <div
      className="one-chat-stage"
      data-testid="one-chat-stage"
      data-screen-kind={screen.what}
      aria-label={screen.title}
    >
      <iframe
        key={`${screen.what}:${screen.url}`}
        src={screen.url}
        title={screen.title}
        data-testid={screen.what === 'app' ? 'one-chat-base' : 'one-chat-page'}
        onLoad={onReady}
      />
    </div>
  )
}
