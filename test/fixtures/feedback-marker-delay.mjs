// Expose the interval between opening a crash marker and finishing its write; the provider commit is untouched.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const write = fs.writeFileSync;
fs.writeFileSync = (path, ...args) => {
  if (typeof path === 'string' && /committed\.json(?:\.tmp)?$/.test(path)) {
    fs.closeSync(fs.openSync(path, 'w'));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
  }
  return write(path, ...args);
};
syncBuiltinESMExports();
