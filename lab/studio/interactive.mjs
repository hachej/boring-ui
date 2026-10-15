// The studio's host policy for running HTML pages (the interactive preview of the HTML pane). Opt-in: the preview runs scripts only because the studio passes this.
// Pages run in a sandboxed frame with an opaque origin and a Content-Security-Policy that allows inline code plus these two library CDNs and nothing
// else (no network requests, no frames, no forms). Pinned library versions are the page's responsibility.
export const SCRIPT_SOURCES = ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'];
export const INTERACTIVE_HTML = { scriptSources: SCRIPT_SOURCES };

/** What an agent that writes HTML pages is told about where they run (the artifact agent's instructions). */
export const HTML_RUNTIME_NOTE = `HTML pages are shown running in a sandbox (the preview): your inline <script> and <style> work, and you may load a library with a <script src> only from https://cdnjs.cloudflare.com or https://cdn.jsdelivr.net, with an exact pinned version in the URL (for example https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js). The page has no network access (fetch, XHR and WebSocket fail), no cookies or storage, cannot open windows or submit forms, and cannot read images from the web: draw with SVG, canvas or CSS and embed small images as data: URIs. Make the page self-contained, responsive to the frame's size and working without any user account.`;
