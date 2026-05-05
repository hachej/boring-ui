// Vercel function entrypoint.
// `pnpm --filter full-app build` generates ./generated-index.ts with a bundled
// serverless handler so workspace package imports are self-contained inside the
// Vercel function artifact.
export { default } from './generated-index.js'
