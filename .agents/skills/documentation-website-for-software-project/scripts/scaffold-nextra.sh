#!/usr/bin/env bash
# scaffold-nextra.sh — create a Nextra 4 App Router docs site
#
# Usage:
#   scaffold-nextra.sh <site-dir> [project-name]
#
# Creates all the files needed for a fresh Nextra site wired to content/. Does
# NOT run `bun install` or `bun run build` — the caller controls those. Does
# NOT overwrite existing files (safe to re-run on a partially scaffolded dir).

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <site-dir> [project-name]" >&2
  exit 2
fi

SITE_DIR="$1"
PROJECT_NAME="${2:-$(basename "$SITE_DIR" | sed 's/__nextra_documentation_site$//')}"

mkdir -p "$SITE_DIR"/{app,content,public}
mkdir -p "$SITE_DIR/app/[[...mdxPath]]"

write_if_missing() {
  local path="$1"
  shift
  if [[ -e "$path" ]]; then
    echo "skip (exists): $path" >&2
    return 0
  fi
  cat > "$path"
  echo "wrote:          $path" >&2
}

# ---------- package.json ----------
write_if_missing "$SITE_DIR/package.json" <<JSON
{
  "name": "${PROJECT_NAME}-docs",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next",
    "build": "next build",
    "postbuild": "pagefind --site .next/server/app --output-path public/_pagefind",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^16.0.7",
    "nextra": "^4.0.0",
    "nextra-theme-docs": "^4.0.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.1.8",
    "pagefind": "^1.3.0",
    "typescript": "^5.5.0"
  }
}
JSON

# ---------- .node-version ----------
write_if_missing "$SITE_DIR/.node-version" <<EOF
22
EOF

# ---------- tsconfig.json ----------
write_if_missing "$SITE_DIR/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", "**/*.mdx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
JSON

# ---------- next.config.ts ----------
write_if_missing "$SITE_DIR/next.config.ts" <<'TS'
import nextra from 'nextra'

const withNextra = nextra({
  latex: true,
  defaultShowCopyCode: true,
  search: {
    codeblocks: false
  },
  contentDirBasePath: '/'
})

export default withNextra({
  reactStrictMode: true
})
TS

# ---------- mdx-components.tsx ----------
write_if_missing "$SITE_DIR/mdx-components.tsx" <<'TSX'
import { useMDXComponents as getDocsMDXComponents } from 'nextra-theme-docs'

const docsComponents = getDocsMDXComponents()

export const useMDXComponents = (components?: Record<string, unknown>) => ({
  ...docsComponents,
  ...components
})
TSX

# ---------- app/layout.tsx ----------
write_if_missing "$SITE_DIR/app/layout.tsx" <<TSX
import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'

export const metadata = {
  title: { default: '${PROJECT_NAME} Docs', template: '%s — ${PROJECT_NAME}' },
  description: '${PROJECT_NAME} documentation.'
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pageMap = await getPageMap()

  const navbar = (
    <Navbar
      logo={<b>${PROJECT_NAME}</b>}
      projectLink="https://github.com/your-org/${PROJECT_NAME}"
    />
  )

  const footer = <Footer>MIT {new Date().getFullYear()} © ${PROJECT_NAME}.</Footer>

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head faviconGlyph="📘" />
      <body>
        <Layout
          pageMap={pageMap}
          navbar={navbar}
          footer={footer}
          docsRepositoryBase="https://github.com/your-org/${PROJECT_NAME}/blob/main"
          editLink="Edit this page on GitHub"
          feedback={{ content: 'Question? Give us feedback →' }}
          lastUpdated={{ formatOptions: { dateStyle: 'medium' } }}
          sidebar={{ defaultMenuCollapseLevel: 1, autoCollapse: true }}
          toc={{ float: true }}
          navigation={{ prev: true, next: true }}
          darkMode
          search={{ placeholder: 'Search docs…' }}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
TSX

# ---------- app/[[...mdxPath]]/page.jsx ----------
write_if_missing "$SITE_DIR/app/[[...mdxPath]]/page.jsx" <<'JSX'
import { generateStaticParamsFor, importPage } from 'nextra/pages'
import { useMDXComponents as getMDXComponents } from '../../mdx-components'

export const generateStaticParams = generateStaticParamsFor('mdxPath')

export async function generateMetadata(props) {
  const params = await props.params
  const { metadata } = await importPage(params.mdxPath)
  return metadata
}

const Wrapper = getMDXComponents().wrapper

export default async function Page(props) {
  const params = await props.params
  const { default: MDXContent, toc, metadata, sourceCode } =
    await importPage(params.mdxPath)
  return (
    <Wrapper toc={toc} metadata={metadata} sourceCode={sourceCode}>
      <MDXContent {...props} params={params} />
    </Wrapper>
  )
}
JSX

# ---------- app/_meta.global.tsx (stub; generator will enrich later) ----------
write_if_missing "$SITE_DIR/app/_meta.global.tsx" <<'TSX'
import type { MetaRecord } from 'nextra'

export default {
  index: {
    type: 'page',
    display: 'hidden'
  }
} satisfies MetaRecord
TSX

# ---------- content/index.mdx (landing page stub) ----------
write_if_missing "$SITE_DIR/content/index.mdx" <<MDX
---
title: ${PROJECT_NAME}
description: ${PROJECT_NAME} documentation.
---

import { Cards } from 'nextra/components'

# ${PROJECT_NAME}

<!-- Synthesis agent (Phase 3) will replace this with a real landing page. -->

<Cards>
  <Cards.Card title="Overview" href="/overview/what-is-this" arrow />
  <Cards.Card title="Contributing" href="/overview/contributing" arrow />
</Cards>
MDX

# ---------- .gitignore ----------
write_if_missing "$SITE_DIR/.gitignore" <<'EOF'
node_modules/
.next/
out/
.DS_Store
*.log
.env*
public/_pagefind/
.docs_workspace/
.vercel/
EOF

# ---------- README.md ----------
write_if_missing "$SITE_DIR/README.md" <<MD
# ${PROJECT_NAME} docs

Generated by the \`documentation-website-for-software-project\` skill.

## Dev

\`\`\`sh
bun install
bun dev
\`\`\`

## Build

\`\`\`sh
bun run build
\`\`\`

## Deploy

This site can deploy to Vercel (recommended) or self-host with \`bun start\`.
Ask the \`documentation-website-for-software-project\` skill to walk you through either path.
MD

echo ""
echo "Scaffold complete at $SITE_DIR"
echo "Next: cd $SITE_DIR && bun install && bun dev"
