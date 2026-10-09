// Node-only modules reached only on paths the browser never takes (pi-codemode's wasm file loader, pi-ai's local OAuth
// callback server, just-bash's gzip commands). Importing is fine; calling fails loudly.
const unavailable = (name: string) => (): never => { throw new Error(`${name} is not available in the browser`); };
export const readFile = unavailable('fs.readFile');
export const createRequire = (): { resolve: () => never } => ({ resolve: unavailable('require.resolve') });
export const createServer = unavailable('http.createServer');
export const gunzipSync = unavailable('zlib.gunzipSync');
export const gzipSync = unavailable('zlib.gzipSync');
export const constants = { Z_BEST_COMPRESSION: 9, Z_BEST_SPEED: 1, Z_DEFAULT_COMPRESSION: -1 };
export default {};
