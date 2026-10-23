/** The image media types the image viewer shows, with their short names. Its own module: the image kind matches on it without loading the viewer. */
export const IMAGE_TYPES: Readonly<Record<string, string>> = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/gif': 'GIF', 'image/webp': 'WebP', 'image/svg+xml': 'SVG' };
