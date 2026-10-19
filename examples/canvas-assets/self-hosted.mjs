// The host's tldraw asset map: fonts, icons, translations and embed icons served from `base` (this app's origin), never from
// cdn.tldraw.com. Pass the result as `assetUrls` to CanvasEditor; the editor refuses any map that leaves a value out.
import { LANGUAGES } from '@tldraw/editor';
import { DEFAULT_EMBED_DEFINITIONS, defaultEditorAssetUrls, iconTypes } from 'tldraw';

export function selfHostedCanvasAssetUrls(base) {
  const local = url => url.replace(/^https:\/\/cdn\.tldraw\.com\/[^/]+/, base);
  return {
    fonts: Object.fromEntries(Object.entries(defaultEditorAssetUrls.fonts).map(([key, url]) => [key, local(String(url))])),
    icons: Object.fromEntries(iconTypes.map(name => [name, `${base}/icons/icon/0_merged.svg#${name}`])),
    translations: Object.fromEntries(LANGUAGES.map(({ locale }) => [locale, `${base}/translations/${locale}.json`])),
    embedIcons: Object.fromEntries(DEFAULT_EMBED_DEFINITIONS.map(({ type }) => [type, `${base}/embed-icons/${type}.png`])),
  };
}
