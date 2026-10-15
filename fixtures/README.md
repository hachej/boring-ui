# Fixtures

Scripted contract proofs with no product UI: each `.mjs` file here drives a library contract (native chat, documents, remote files and shell, current-hub, validated output, resource transport) with fictional data and prints a result.

Run `npm run build`, then `node fixtures/<name>.mjs`. Folders (`current-hub/`, `validated-output/`, `live-slice/`) hold the larger fixtures with their own README or journey; tests under `test/` import them.
