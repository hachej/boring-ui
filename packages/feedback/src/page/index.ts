// @hachej/boring-feedback/page: browser-side privacy policy, the `app.dom@1` serializer and the privacy canary kit (WP3); `app.element@1` pins (WP5);
// the picker and its overlay (WP6); voice capture and speech-to-pointer alignment.
export * from './privacy/index.js';
export {
  runPrivacyCanaries, defaultCanaries, CANARY_CHANNELS, CANARY_SECTION_ATTRIBUTE,
  type CanaryChannel, type CanaryPage, type CanaryRun, type CanaryHit, type CanaryResult, type PrivacyCanaryOptions,
} from './canaries.js';
export {
  anchorOf, rangeOf, resolveAppElement, revealElement, fallbackOf, appElementResolution, appElementSchema, APP_ELEMENT_KIND,
  type AppElementAnchor, type AppElementSignals, type AppElementIdentity, type AppElementRange, type AppElementCapture, type AnchorOfOptions, type RevealResult,
} from './app-element.js';
export * from './picker/index.js';
// Voice capture and speech-to-pointer alignment.
export * from './voice/index.js';
