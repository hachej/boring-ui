// A metered native conversation killed with SIGKILL at a chosen point, then recovered from Pi's SQLite state and the SQLite ledger.
//   interrupt  the model has streamed a committed partial and never answers; the parent kills the process
//   settle     the run finished and its usage is recorded; the process kills itself inside settleRun
//   recover    a new process: Pi resumes the conversation, `meter.recover` finishes the run the ledger still holds open
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Harness, LiveDoc, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createMeter, createSqliteLedger } from '@hachej/boring-agent/metering';
import { createFakeChatModel } from '@hachej/boring-testing/model';

const [directory, phase] = process.argv.slice(2);
const keepAlive = setInterval(() => {}, 1000); // the crash phases wait here for SIGKILL
const ACCOUNT = 'fictional-person', SCOPE = { userId: ACCOUNT, workspaceId: 'fictional-workspace', attributes: { plan: 'fictional-free' } }, USAGE = { input: 1000, output: 500 };
const fake = createFakeChatModel({ cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } });
const connection = openNodeConnection(join(directory, 'ledger.sqlite'));
const ledger = createSqliteLedger({ connection, holdMicros: 5000 });
await ledger.grant(ACCOUNT, 100_000, 'fictional-signup');
const sink = phase === 'settle' ? { ...ledger, settleRun: async () => { process.kill(process.pid, 'SIGKILL'); await new Promise(() => {}); } } : ledger;
const meter = createMeter({ sink, context, models: fake.models });
const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry: createRegistry(), models: fake.models }, context);
const conversation = await harness.root(context, { agent: { model: fake.model } });

if (phase !== 'recover') {
  await meter.conversation(conversation, SCOPE).submit({ type: 'input', requestId: 'fictional-request', content: 'Fictional question' }, context);
  const call = await fake.nextCall();
  if (phase === 'settle') { call.respond('Fictional answer', USAGE); await new Promise(() => {}); }
  call.append('Fictional partial');
  for (;;) {
    const live = await harness.snapshot(LiveDoc, conversation.id, context);
    if (live?.generation?.message?.content?.length) break;
    await delay(10);
  }
  writeFileSync(join(directory, 'ready.json'), JSON.stringify({ open: await ledger.openRuns(), balance: await ledger.balance(ACCOUNT) }));
  await new Promise(() => {});
} else {
  const before = { open: await ledger.openRuns(), balance: await ledger.balance(ACCOUNT) };
  await meter.recover(harness);
  harness.resume();
  // An interrupted generation runs again on recovery: this time the model answers.
  const answering = (async () => { for (;;) { const call = await fake.nextCall(); call.respond('Fictional answer after recovery', USAGE); } })();
  void answering;
  const until = Date.now() + 10000;
  while ((await ledger.openRuns()).length) { if (Date.now() > until) throw new Error('The open run was not reconciled'); await delay(20); }
  await meter.flush();
  const record = await conversation.commit(tx => tx.submissionByRequest(conversation.id, 'fictional-request'), context);
  const runs = connection.all('SELECT run_id, state, reason FROM boring_metering_runs');
  const charges = connection.all('SELECT step, amount FROM boring_metering_charges ORDER BY step');
  writeFileSync(join(directory, 'recovered.json'), JSON.stringify({ before, record, runs, charges, balance: await ledger.balance(ACCOUNT), calls: fake.calls.length }));
  await meter.close();
  await harness.close(context);
  connection.close();
  clearInterval(keepAlive); process.exit(0);
}
