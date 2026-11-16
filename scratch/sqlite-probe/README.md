# host-probe-shared-sqlite (scratch, never merged)

Base: `origin/host-contract` at `6cb216afb`, plain `npm ci`; `npm run build` (the repo's own, for `@hachej/boring-files` dist). Pinned pi-durable 1.5.2, wrangler 4.156.0 (workerd local, no account).

Run: `node scratch/sqlite-probe/run.mjs --candidates` (starts `wrangler dev --local` on :18821, prints one block per run, stops it by pid).
Candidate (a) type check: `node_modules/.bin/tsc --noEmit --skipLibCheck --strict --target es2022 --module nodenext --moduleResolution nodenext scratch/sqlite-probe/candidate-a.ts`.

Interleavings (`place`): `request` (a second request writes the files while pi's transaction awaits), `inflight` (a fiber already running in the object writes them), `inside` (the files are written from the transaction callback itself). `mode=direct`: boring-files' `durableObjectSqliteConnection` on the object's own storage; `mode=b`: the files in a second object (`FilesBox`).
