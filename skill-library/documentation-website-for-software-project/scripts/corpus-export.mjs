#!/usr/bin/env node
// Exports docs corpus in machine-friendly shapes.
// Produces: dist/corpus/chunks.jsonl, llms.txt, llms-full.txt, per-page plaintext.
// See references/CORPUS-EXPORT.md.

import { glob } from 'glob';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { execFileSync } from 'node:child_process';

const BASE_URL = process.env.DOCS_BASE_URL || 'https://docs.example.io';
const PROJECT = process.env.DOCS_PROJECT || 'my-project';
const VERSION = process.env.DOCS_VERSION || 'unversioned';

function approxTokens(text) {
  // Rough heuristic: 1 token per ~4 characters of English text.
  return Math.ceil(text.length / 4);
}

function docsSha() {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

function chunkByHeadings(content, baseBreadcrumb) {
  const chunks = [];
  const lines = content.split('\n');
  let current = { heading: baseBreadcrumb.at(-1) || '', breadcrumb: [...baseBreadcrumb], lines: [] };
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      if (current.lines.length) chunks.push(current);
      current = { heading: h2[1], breadcrumb: [...baseBreadcrumb, h2[1]], lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length) chunks.push(current);
  return chunks;
}

const distDir = 'dist/corpus';
fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(path.join(distDir, 'pages'), { recursive: true });

const pages = await glob('content/**/*.mdx', { absolute: false });
const chunksJsonl = fs.createWriteStream(path.join(distDir, 'chunks.jsonl'));
const llmsFull = [];
const llmsIndex = [];

for (const p of pages) {
  const raw = fs.readFileSync(p, 'utf8');
  const { data, content } = matter(raw);
  const slug = p.replace(/^content\//, '').replace(/\.mdx$/, '').replace(/\/index$/, '');
  const url = `${BASE_URL}/${slug}`;
  const title = data.title || slug;
  const description = data.description || '';

  llmsIndex.push(`- [${title}](${url}): ${description}`);
  llmsFull.push(`# ${title}\n\n${content}\n`);
  fs.writeFileSync(path.join(distDir, 'pages', slug.replace(/\//g, '__') + '.txt'), `${title}\n\n${content}`);

  const chunks = chunkByHeadings(content, [title]);
  for (const ch of chunks) {
    const text = ch.lines.join('\n').trim();
    if (!text) continue;
    const chunkId = ch.heading === title ? slug : `${slug}#${ch.heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    chunksJsonl.write(JSON.stringify({
      id: chunkId,
      url: ch.heading === title ? url : `${url}#${ch.heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: ch.heading,
      breadcrumb: ch.breadcrumb,
      text,
      tokens: approxTokens(text),
      metadata: {
        audience: data.audience || null,
        quadrant: data.quadrant || null,
        archetype: data.archetype || null,
        version: VERSION,
      },
    }) + '\n');
  }
}
chunksJsonl.end();

// llms.txt
fs.writeFileSync(path.join(distDir, 'llms.txt'),
  `# ${PROJECT}\n\n> Auto-generated from docs build.\n\n## Docs\n\n${llmsIndex.join('\n')}\n`);

// llms-full.txt
fs.writeFileSync(path.join(distDir, 'llms-full.txt'),
  `# ${PROJECT} — Full Documentation\n\n${llmsFull.join('\n---\n\n')}`);

// manifest
fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify({
  project: PROJECT,
  project_version: VERSION,
  docs_sha: docsSha(),
  exporter_version: '1.0.0',
  exported_at: new Date().toISOString(),
  pages: pages.length,
}, null, 2));

console.log(`Exported corpus: ${pages.length} pages → ${distDir}/`);
