import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function retryJourney(scenario, run) {
  try { return await run(); }
  catch (error) {
    console.error(error);
    console.log(`retried after flake: ${scenario}`);
    return await run();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [scenario] = process.argv.slice(2);
  if (process.argv.length !== 3 || !/^[\w-]+:journey(?::[\w-]+)*$/.test(scenario ?? '') || scenario === 'studio:journey:scripted') throw new Error('Use a journey npm script; studio scripted scenarios retry individually');
  try {
    await retryJourney(scenario, () => {
      const result = spawnSync('npm', ['run', scenario], { stdio: 'inherit' });
      if (result.status !== 0 || result.error) throw new Error(`${scenario} failed (exit ${result.status}, signal ${result.signal ?? 'none'})`);
    });
  } catch (error) { console.error(error); process.exitCode = 1; }
}
