// Read-only validator seam probe; no models, tools, credentials or production calls.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const app = resolve(process.argv[2] ?? '../boring-clinic-redaction');
const { validate: preparation } = await import(pathToFileURL(resolve(app, 'agents/preparation/index.mjs')).href);
const { validate: assistant } = await import(pathToFileURL(resolve(app, 'agents/assistant/index.mjs')).href);
const headings = ["Vue d'ensemble", 'Prévention et dépistage', 'Facteurs de risque cardiovasculaire', 'Suivi spécialisé et biologique', 'Histoire récente', "À explorer aujourd'hui"];
const invented = headings.map((heading, index) => `### ${heading}\n${index === 2 ? 'SCORE2 42 % — invented unsupported probe value.' : 'Invented probe text.'}`).join('\n\n');
assert.equal(preparation(invented), invented);
assert.throws(() => preparation(invented, { trace: [] }), /SCORE2/);
console.log('CONFIRMED: preparation accepts unsupported SCORE2 without trace; refuses it with empty trace.');
const marked = '🌐 Invented source-marked probe claim.';
assert.equal(assistant(marked), marked);
assert.throws(() => assistant(marked, { trace: [] }), /source/);
console.log('CONFIRMED: assistant accepts unsupported source marker without trace; refuses it with empty trace.');
console.log('Scope: validator calls only. Installed Flue omits trace by source inspection; no live answer or patient data tested.');
