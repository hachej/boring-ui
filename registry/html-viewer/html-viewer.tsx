'use client';

import { HtmlViewer as RuntimeHtmlViewer } from '@hachej/boring-ui-kit/html-viewer';
import type { HtmlViewerProps } from '@hachej/boring-ui-kit/html-viewer';

export type { HtmlViewerProps } from '@hachej/boring-ui-kit/html-viewer';

export function HtmlViewer({ className, ...props }: HtmlViewerProps) {
  return <RuntimeHtmlViewer {...props} className={['boring-html-recipe', className].filter(Boolean).join(' ')} />;
}
