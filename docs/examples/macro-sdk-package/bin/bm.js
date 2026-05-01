#!/usr/bin/env node

/**
 * CLI entry point for @boring/macro-sdk
 * 
 * Usage:
 *   bm run --tool custom:ma12 --input series1 --output derived1 --title "YoY"
 *   bm list
 *   bm scaffold --name my_transform
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const cliPath = join(__dirname, '../sdk/boring_macro/_cli.py');
const args = process.argv.slice(2);

// Check if Python is available
const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

const child = spawn(pythonCmd, [cliPath, ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    // Pass through any workspace-specific config
    WORKSPACE_ROOT: process.env.WORKSPACE_ROOT || process.cwd(),
  },
});

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(`Error: '${pythonCmd}' is not installed or not in PATH.`);
    console.error('Please install Python 3.10+ and try again.');
    process.exit(1);
  }
  console.error('CLI error:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
