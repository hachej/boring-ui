import { copyText } from '../utils/utils';

/** What the frame hands the host when the person presses Share. `target` and `revision` are the host's own identifiers for what is shown. */
export interface ViewerShareRequest {
  readonly title: string;
  readonly target: unknown;
  readonly revision: string | undefined;
}

/** `shared`: the system share sheet took it. `copied`: a link is on the clipboard (the frame says so). Nothing: the host confirmed it its own way. */
export type ViewerShareResult = 'shared' | 'copied' | undefined | void;
export type ViewerShare = (request: ViewerShareRequest) => ViewerShareResult | Promise<ViewerShareResult>;

/**
 * The ready-made Share action. `link` turns the request into the URL a person can open to see the same thing. Uses the Web Share
 * API where the browser offers it (phones), otherwise copies the link (see `copyText`) and lets the frame show "Link copied". A cancelled share
 * sheet is not an error.
 */
export function createLinkShare(link: (request: ViewerShareRequest) => string): ViewerShare {
  return async request => {
    const url = link(request);
    const nav = globalThis.navigator;
    if (typeof nav?.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare({ title: request.title, url }))) {
      try { await nav.share({ title: request.title, url }); return 'shared'; }
      catch (error) { if ((error as { name?: string })?.name === 'AbortError') return undefined; /* fall back to the clipboard */ }
    }
    // Clipboard API, then execCommand; when neither works copyText throws ManualCopyError and the frame shows the link selected.
    await copyText(url);
    return 'copied';
  };
}
