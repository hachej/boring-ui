// One module per demo area, discovered automatically (all *.mjs except index.mjs), ordered by the default
// export's optional `order` property, then by file name. Each receives the journey toolkit `t` (see ../journey.mjs).
import { readdirSync } from 'node:fs';

const files = readdirSync(new URL('.', import.meta.url)).filter(name => name.endsWith('.mjs') && name !== 'index.mjs').sort();
const loaded = await Promise.all(files.map(async name => [name.replace(/\.mjs$/, ''), (await import(new URL(name, import.meta.url))).default]));
export const JOURNEYS = Object.fromEntries(loaded.sort((a, b) => (a[1].order ?? 100) - (b[1].order ?? 100)));
