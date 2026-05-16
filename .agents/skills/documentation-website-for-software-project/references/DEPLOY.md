# Deploy & E2E Smoke

Two paths. **Default: Vercel.** Fallback: self-host with bun (or `next start` / static export).‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

---

## A. Vercel (recommended)

The free tier is fine for a low-traffic internal docs site. Deploy via CLI so we get the URL back inside the session.

### Prereqs

```bash
# Claude Code session
which gh       # for repo creation; if missing, brew install gh / apt install gh
which vercel   # if missing:
bun add -g vercel     # or: npm i -g vercel
which bun      # if missing:
# Linux/macOS:  curl -fsSL https://bun.sh/install | bash
# Windows (PowerShell):  powershell -c "irm bun.sh/install.ps1 | iex"
```

If `/vercel` skill is available, prefer it for all vercel CLI invocations.

### Auth (one-time per machine)

```bash
gh auth login        # pick GitHub, HTTPS, authenticate via web
vercel login         # follow the email link
```

### Deploy — GitHub-connected path (preferred, gives preview deploys on every push)

```bash
cd <site-dir>
git add -A && git commit -m "Initial Nextra docs site"

# Create the remote repo (private by default)
gh repo create <org>/<repo>-docs --source=. --private --push

# Link + deploy
vercel link --yes      # creates .vercel/ metadata
vercel --prod --yes    # first prod deploy
```

Vercel auto-detects Next.js. Build command is `next build`; output directory is `.next/`. For Pagefind search to work we also need the `postbuild` step — it already runs automatically because Vercel executes `postbuild` from `package.json`.

### Deploy — CLI-only path (no GitHub)

```bash
cd <site-dir>
vercel link --yes
vercel --prod --yes
```

Preview deploys won't happen automatically — you'll need to run `vercel` after each change. Prefer the GitHub path.

### Environment variables (only if needed)

```bash
vercel env add NEXT_PUBLIC_SITE_URL production
# paste value when prompted
```

Re-deploy after env changes: `vercel --prod --yes`.

### Custom domain

```bash
vercel domains add docs.example.com
# Vercel will print the CNAME/A records. Give them to the user to add at their DNS provider.
```

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| Build fails with "Cannot find module 'nextra'" | Root dir set wrong in Vercel; `vercel link` from the site dir, not the parent. |
| Build works but search empty | Pagefind `postbuild` didn't run. Check `package.json` scripts; verify `public/_pagefind/pagefind.js` in deploy logs. |
| "Node version" error | Add `.node-version` containing `22` to the site dir root. |
| Build exceeds 45-min hard limit | Docs build should never take this long — you've probably pulled in the source repo's massive dependencies. Make sure only the site dir is the project root. |
| MDX compile error with Turbopack on dev but green prod | See `/tmp/nextra/docs/next.config.ts`'s `rehypeOpenGraphImage` gate — only mount non-serializable plugins in production. |
| Edit link 404 | `docsRepositoryBase` in `<Layout>` must point at the MDX dir, not the repo root. |

---

## B. Self-host with bun

Two flavors: SSR (`bun start`) or static export (`next build && serve out/`).

### SSR

```bash
cd <site-dir>
bun install
bun run build       # .next/ output
bun start           # binds :3000

# Reverse-proxy with nginx / caddy if exposing publicly
```

### Static export

`next.config.ts`:
```ts
export default withNextra({
  output: 'export',
  images: { unoptimized: true }
})
```

`package.json` postbuild (Pagefind now points at `out/`):
```json
"postbuild": "pagefind --site out --output-path out/_pagefind"
```

Build + serve:
```bash
bun run build
# Host out/ on any static host: S3, GitHub Pages, nginx root, etc.
# Local preview:
bunx serve out -p 3000
```

Caveats of static export:
- No `next/image` optimization (we set `unoptimized: true`).
- No runtime API routes. Nextra docs don't need any by default.
- OG image generation via `next/og` requires SSR; with static export you'd pre-generate them at build time.​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌

---

## C. Playwright smoke tests (Phase 9)

Use `/e2e-testing-for-webapps` if available. Otherwise, minimal standalone setup:

```bash
cd <site-dir>
bun add -D @playwright/test
bunx playwright install chromium
```

`tests/smoke.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

const BASE = process.env.SMOKE_URL ?? 'http://localhost:3000'

test('home renders', async ({ page }) => {
  await page.goto(BASE)
  await expect(page).toHaveTitle(/.+/)  // a non-empty title
  await expect(page.locator('nav')).toBeVisible()
})

test('search finds a known term', async ({ page }) => {
  await page.goto(BASE)
  // Pagefind's search input is injected by nextra-theme-docs:
  const search = page.getByPlaceholder(/search/i)
  await search.click()
  await search.fill('overview')
  await expect(page.getByRole('link', { name: /overview/i }).first()).toBeVisible({ timeout: 5000 })
})

test('dark mode toggle', async ({ page }) => {
  await page.goto(BASE)
  const html = page.locator('html')
  const initial = await html.getAttribute('class')
  await page.getByRole('button', { name: /theme|dark|light/i }).first().click()
  const after = await html.getAttribute('class')
  expect(after).not.toBe(initial)
})

test('mobile sidebar', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } })
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.getByRole('button', { name: /menu|nav/i }).first().click()
  await expect(page.locator('nav').first()).toBeVisible()
  await ctx.close()
})

test('deep page w/ mermaid renders SVG', async ({ page }) => {
  await page.goto(`${BASE}/overview/architecture`)
  await expect(page.locator('svg').first()).toBeVisible({ timeout: 5000 })
})
```

Run:
```bash
# Against Vercel deploy
SMOKE_URL=https://<your-project>.vercel.app bunx playwright test

# Against local dev
bun dev &
SMOKE_URL=http://localhost:3000 bunx playwright test
```

Save screenshots for archival:
```bash
SMOKE_URL=... bunx playwright test --screenshot=only-on-failure --output=phase9_screenshots/
```

### Visual review

Use `/ui-polish` and `/ux-audit` skills if available. Otherwise manually:

1. Home — dark + light screenshots
2. Section landing — dark + light
3. One deep page with mermaid + code block + callout — dark + light
4. Mobile home + mobile sidebar open

Paste to `phase9_screenshots/` (or describe in `phase9_log.md` if headless).

---

## D. Connecting the pipelines

If the user wants CI deploys (push → build → deploy), the `/gh-actions` skill gives you the workflow. Short version — add `.github/workflows/deploy.yml`:

```yaml
name: Deploy docs
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bunx vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}
      - run: bunx vercel build --prod --token=${{ secrets.VERCEL_TOKEN }}
      - run: bunx vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
```

With secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (from `vercel link` — they land in `.vercel/project.json`). The `vercel pull` step downloads env vars and project settings; `vercel build` produces `.vercel/output/`; `vercel deploy --prebuilt` uploads that directory without rebuilding. For simple projects, the GitHub-connected auto-deploy path is easier — skip CI.

---

## E. Cloudflare Pages (alternative static host)

Good fit for static-export builds (`output: 'export'`). Cloudflare's generous free tier + fast CDN make it attractive for docs.

### Prereqs

```bash
bun add -g wrangler
wrangler login
```

If the `/wrangler` skill is installed, prefer it for all CF operations.

### Setup

1. Configure Nextra for static export (see § B § Static export).
2. Build:
   ```bash
   bun run build
   # postbuild runs: pagefind --site out --output-path out/_pagefind
   ```
3. Deploy:
   ```bash
   wrangler pages deploy out --project-name=mydocs --branch=main
   ```

### CI (GitHub Actions)

```yaml
name: Deploy docs to Cloudflare Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy out --project-name=mydocs --branch=${{ github.ref_name }}
```

### Custom domain

Add via the Cloudflare Pages dashboard or `wrangler pages project domains add`. Cloudflare handles SSL automatically.

### Caveats (vs Vercel)

- No SSR/ISR — static export only. No `next/og` runtime; pre-generate OG images at build or use the Satori pattern that renders at request-time on Workers (more advanced).
- Pagefind postbuild needs to run BEFORE deploy (in CI or locally before `wrangler pages deploy`).
- Image optimization via `next/image` needs `unoptimized: true` or a custom loader pointing at Cloudflare Images.

---

## F. GitHub Pages (zero infra)

Simplest path if the user has no Vercel/Cloudflare account. Requires static export.

### Setup

1. `output: 'export'` + `images: { unoptimized: true }` + `basePath` if using a project page:
   ```ts
   export default withNextra({
     output: 'export',
     images: { unoptimized: true },
     basePath: '/mydocs'   // if repo is at github.com/org/mydocs
   })
   ```

2. GitHub Actions workflow:
   ```yaml filename=".github/workflows/gh-pages.yml"
   name: Deploy docs to GitHub Pages
   on:
     push:
       branches: [main]
   permissions:
     contents: read
     pages: write
     id-token: write
   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: oven-sh/setup-bun@v2
         - run: bun install
         - run: bun run build
         - uses: actions/upload-pages-artifact@v3
           with:
             path: out
     deploy:
       needs: build
       runs-on: ubuntu-latest
       environment:
         name: github-pages
         url: ${{ steps.deployment.outputs.page_url }}
       steps:
         - id: deployment
           uses: actions/deploy-pages@v4
   ```

3. Enable Pages in repo settings: Settings → Pages → "GitHub Actions" as source.

### Caveats

- URL: `<username>.github.io/<repo>` unless you add a `CNAME` file in `public/`.
- `basePath` affects every internal link — `next/link` handles it, but MDX absolute paths must match.
- No serverless functions → static only.

---

## G. Docker self-host

For full control or air-gapped deployments.

```dockerfile filename="Dockerfile"​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json bun.lockb* package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-alpine AS builder
WORKDIR /app
COPY . .
COPY --from=deps /app/node_modules ./node_modules
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "start"]
```

Build + run:
```bash
docker build -t mydocs .
docker run --rm -p 3000:3000 mydocs
```

For `output: 'standalone'` (smaller image, requires Next.js config change):
```ts
export default withNextra({ output: 'standalone' })
```

### Caveats

- Pagefind postbuild must run before the image is built (add to `builder` stage after `npm run build`).
- Multi-stage build keeps image under 200 MB.
- Use `tini` or a similar init if running in Kubernetes.

---

## H. S3 + CloudFront (advanced static hosting)

For teams on AWS.

```bash
bun run build  # static export to out/
aws s3 sync out s3://my-docs-bucket --delete
aws cloudfront create-invalidation --distribution-id $CF_DIST_ID --paths '/*'
```

### Setup

1. S3 bucket: public read access (or CloudFront OAC with bucket policy).
2. CloudFront distribution: origin = S3, default root object = `index.html`, custom error page for `404.html`.
3. Route 53 (or any DNS) CNAME to the CloudFront domain.
4. CI:
   ```yaml
   - run: bun run build
   - uses: aws-actions/configure-aws-credentials@v4
     with:
       role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE }}
       aws-region: us-east-1
   - run: aws s3 sync out s3://my-docs-bucket --delete
   - run: aws cloudfront create-invalidation --distribution-id ${{ secrets.CF_DIST_ID }} --paths '/*'
   ```

### Caveats

- OIDC + IAM role (preferred over long-lived keys).
- CloudFront response headers need configuring for security (HSTS, X-Content-Type-Options). Use a CloudFront Function or response policy.

---

## I. Preview deployments workflow

Every PR should produce a preview URL the reviewer can click.

### Vercel

Happens automatically if the site is GitHub-connected. Each PR gets `<project>-git-<branch>.vercel.app`. No setup.

### Cloudflare Pages

Also automatic via the dashboard git integration. Or in CI:
```yaml
- run: wrangler pages deploy out --project-name=mydocs --branch=${{ github.head_ref || github.ref_name }}
```
A non-`main` branch becomes a preview URL.

### GitHub Pages

No built-in previews. Use a separate deploy target (e.g., Netlify, Cloudflare Pages) for previews and GH Pages only for main.

---

## J. Hostname splitting (docs vs app on the same domain)

Common pattern for SaaS: `docs.example.com` for docs, `app.example.com` for the authenticated app. See the [`vercel` skill](../../vercel/SKILL.md)'s hostname-splitting guidance — same idea here. Put docs on Vercel/Cloudflare Pages; point `docs.` DNS at it with DNS-only (no proxy) mode in Cloudflare.

---

## K. Runtime environment variables

Some deploys need runtime config (analytics ID, repo URL, support contact). Best practice:

- `NEXT_PUBLIC_*` vars are baked at build time; exposed to the browser. Use for non-secret config.
- Everything else is server-only; don't use in static exports.

For docs sites, public values like `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_GITHUB_REPO` are common. Set once per deployment:
```bash
vercel env add NEXT_PUBLIC_SITE_URL production
wrangler pages secret put NEXT_PUBLIC_SITE_URL  # Cloudflare
```
