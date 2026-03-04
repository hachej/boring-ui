/**
 * Patch customElements.define to fix Lit class field shadowing.
 *
 * Lit reactive properties use prototype getters/setters, but ES class fields
 * create instance own-properties that shadow them. Lit detects this in dev
 * mode and throws, breaking the element.
 *
 * This module wraps customElements.define so that every Lit element's
 * connectedCallback deletes shadowing own-properties before Lit's
 * enableUpdating() check runs.
 *
 * MUST be imported before any @mariozechner/pi-web-ui imports.
 */
const originalDefine = customElements.define

customElements.define = function (name, constructor, options) {
  // Only patch classes that have Lit's elementProperties (ReactiveElement subclasses)
  if (constructor.elementProperties instanceof Map && constructor.elementProperties.size > 0) {
    const origConnectedCallback = constructor.prototype.connectedCallback
    constructor.prototype.connectedCallback = function () {
      for (const key of constructor.elementProperties.keys()) {
        if (Object.prototype.hasOwnProperty.call(this, key)) {
          const value = this[key]
          delete this[key]
          this[key] = value
        }
      }
      return origConnectedCallback?.call(this)
    }
  }
  return originalDefine.call(customElements, name, constructor, options)
}
