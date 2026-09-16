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
      {screen.label ? (
        <div className="one-chat-stage-label" data-testid="one-chat-stage-label" role="status">
          <span>
            {screen.label === 'preview'
              ? (screen.title.startsWith('Sketch:') ? 'Sketch' : 'Preview')
              : screen.versionLabel ? `Previous version · ${screen.versionLabel}` : 'Previous version'}
          </span>
          {screen.revision ? (
            <span className="one-chat-stage-revision" data-testid="one-chat-stage-revision">v{screen.revision}</span>
          ) : null}
          <span>— nothing you do here is saved</span>
        </div>
      ) : null}
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
