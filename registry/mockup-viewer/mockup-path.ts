/** A `*.mockup.html` file: the mock-up kind's match, in its own module so the kind does not load the viewer. */
export const isMockupPath = (path: string): boolean => /\.mockup\.html$/i.test(path);
/** An element's `data-feedback-id` in a mock-up: `mockup:<path>#element=<selector>`. */
export const mockupTarget = (path: string, selector: string): string => `mockup:${path}#element=${selector}`;
