import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkSource } from '../scripts/pi-policy.mjs';

// Structural boundary evidence only: these fixtures do not implement or qualify
// a viewer, FileSystem, sandbox, lifecycle or runtime composition.
const policy = JSON.parse(readFileSync(new URL('../ARCHITECTURE.json', import.meta.url), 'utf8'));
const check = (owner, code) => checkSource(`packages/${owner}/src/composition-example.ts`, code, policy);

test('viewer code may reuse public resource types without an agent facade', () => {
  assert.deepEqual(check('ui', 'import type { ResourceRef } from "@hachej/boring-files/contracts"; export type Ref = ResourceRef;'), []);
});

test('files may describe native filesystem adaptation using public types only', () => {
  assert.deepEqual(check('files', 'import type { FileSystem } from "@earendil-works/pi-durable/env"; import type { Context } from "@earendil-works/chord"; export type Binding = { fs: FileSystem; context: Context };'), []);
});

test('resource type composition does not grant a UI runtime-files import', () => {
  assert.ok(check('ui', 'import { nodeDirectory } from "@hachej/boring-files/server";').length > 0);
  assert.ok(check('ui', 'import { openNodeConnection } from "@hachej/boring-files/sqlite";').length > 0);
  assert.ok(check('ui', 'import * as files from "@hachej/boring-files";').length > 0);
});

test('UI may select the browser-safe publication helper entry', () => {
  assert.deepEqual(check('ui', 'import { publicationDigest } from "@hachej/boring-files/publication";'), []);
});

test('native filesystem type reuse does not permit importing its runtime into files', () => {
  assert.ok(check('files', 'import { FileError } from "@earendil-works/pi-durable/env";').length > 0);
  assert.ok(check('files', 'import { Harness } from "@earendil-works/pi-durable";').length > 0);
});

test('type-only permission does not permit private native source imports', () => {
  assert.ok(check('files', 'import type { FileSystem } from "@earendil-works/pi-durable/src/env/index.ts";').length > 0);
});

test('composition still forbids native processes in the files package', () => {
  assert.ok(check('files', 'import { exec } from "node:child_process";').length > 0);
  assert.ok(check('ui', 'import { Harness } from "@earendil-works/pi-durable";').length > 0);
});
