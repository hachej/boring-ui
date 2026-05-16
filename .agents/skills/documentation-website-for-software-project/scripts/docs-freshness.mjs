#!/usr/bin/env node
// Scans docs for staleness signals. Emits workspace/freshness-report.md.
// See references/LIFECYCLE.md and references/TESTING-DOCS.md §freshness.

import { glob } from 'glob';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';

const STALE_DAYS_HIGH = 180;
const STALE_DAYS_FAQ = 365;
const CURRENT_VERSION = process.env.DOCS_VERSION || null; // e.g. "2.1.0"

function gitLastModified(filePath) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', filePath], { encoding: 'utf8' }).trim();
    return out ? new Date(parseInt(out, 10) * 1000) : null;
  } catch { return null; }
}

function ageInDays(date) {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

const findings = [];
const pages = await glob('content/**/*.mdx', { absolute: false });
for (const p of pages) {
  const raw = fs.readFileSync(p, 'utf8');
  const { data, content } = matter(raw);
  const lastMod = gitLastModified(p);
  const age = ageInDays(lastMod);

  if (age !== null && age > STALE_DAYS_HIGH) {
    findings.push({
      severity: 'med',
      file: p,
      kind: 'time-stale',
      detail: `Last edited ${age} days ago.`,
    });
  }

  // Version-pinned claims — only flag when a trigger word is within ~60 chars
  // of the version to avoid matching unrelated version numbers elsewhere in the page.
  if (CURRENT_VERSION) {
    const claim = content.match(/\b(?:currently|as of|latest(?: version)?|current version)\b[^\n]{0,60}?\b(\d+\.\d+\.\d+)\b/i);
    if (claim && claim[1] !== CURRENT_VERSION) {
      findings.push({
        severity: 'high',
        file: p,
        kind: 'version-drift',
        detail: `Claims "${claim[1]}"; current release is "${CURRENT_VERSION}".`,
      });
    }
  }

  // TODO/FIXME past deadline
  const todos = content.matchAll(/(?:TODO|FIXME)\(([^)]+)\)/g);
  for (const t of todos) {
    const dateMatch = t[1].match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (dateMatch && new Date(dateMatch[1]) < new Date()) {
      findings.push({
        severity: 'med',
        file: p,
        kind: 'overdue-todo',
        detail: `TODO past deadline: ${t[0]}`,
      });
    }
  }

  // FAQ age
  if (data.type === 'faq' || p.includes('/faq')) {
    const reviewed = data.reviewed ? new Date(data.reviewed) : lastMod;
    const revAge = ageInDays(reviewed);
    if (revAge !== null && revAge > STALE_DAYS_FAQ) {
      findings.push({
        severity: 'low',
        file: p,
        kind: 'faq-age',
        detail: `FAQ reviewed ${revAge} days ago.`,
      });
    }
  }
}

// Write report
const workspaceDir = 'workspace';
fs.mkdirSync(workspaceDir, { recursive: true });
const report = [
  '# Freshness Report',
  '',
  `Generated: ${new Date().toISOString()}`,
  `Current version: ${CURRENT_VERSION ?? '(not set; pass DOCS_VERSION env var)'}`,
  `Pages scanned: ${pages.length}`,
  `Findings: ${findings.length}`,
  '',
  ...['high', 'med', 'low'].flatMap(sev => {
    const bucket = findings.filter(f => f.severity === sev);
    if (!bucket.length) return [];
    return [
      `## ${sev.toUpperCase()} severity (${bucket.length})`,
      '',
      ...bucket.map(f => `- **${f.file}** — ${f.kind}: ${f.detail}`),
      '',
    ];
  }),
].join('\n');
fs.writeFileSync(path.join(workspaceDir, 'freshness-report.md'), report);

console.log(`Wrote ${workspaceDir}/freshness-report.md (${findings.length} findings).`);
process.exit(findings.filter(f => f.severity === 'high').length ? 1 : 0);
