export const EMPTY_POTION_VALUE = []
export const potionPlugins = []

export default function PotionEditor() {
  return (
    <div className="editor-loading-state" role="status" aria-live="polite">
      <div className="editor-loading-title">Potion editor not bundled in core</div>
      <div className="editor-loading-detail">
        Register a host-defined markdown pane in the child project instead of depending on
        core `boring-ui` to ship the editor implementation.
      </div>
    </div>
  )
}
