// A fake AgentCore Code Interpreter for offline proofs: an in-process HTTP server that speaks the wire format the real
// `@aws-sdk/client-bedrock-agentcore` client sends and parses (REST JSON requests, an `application/vnd.amazon.eventstream`
// response for InvokeCodeInterpreter), so the adapter is exercised through the unmodified SDK. It implements only what
// `createCodeInterpreterEnv` uses: StartCodeInterpreterSession (with one EFS access point), StopCodeInterpreterSession and
// the tools startCommandExecution, getTask and stopTask. Nothing here talks to AWS; the client gets fictional static keys.
//
// What it fakes, and how:
// - An EFS access point is a local directory (`accessPoints: { [arn]: directory }`): a session started with that access
//   point "mounts" it at the requested mount path. Real isolation comes from the access point's root directory; here a
//   session can only name its own directory, and nothing more is claimed.
// - There is no real mount, so the mount path inside a command is rewritten to the directory (and back in the output).
//   Commands are the adapter's own `umask ... && cd '<mount>' && bash -c '...'`; a script that builds the mount path at
//   runtime would not be rewritten. Output shapes (`structuredContent` with taskId, taskStatus, stdout, stderr, exitCode)
//   follow the SDK's model; how the real service fills them (cumulative output, failure statuses) is not verified.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';

/** One event stream message (AWS event stream encoding: prelude, string headers, payload, CRC32s). */
export function eventMessage(headers, payload) {
  const encodedHeaders = Buffer.concat(Object.entries(headers).map(([name, value]) => {
    const key = Buffer.from(name), text = Buffer.from(value);
    const length = Buffer.alloc(2); length.writeUInt16BE(text.length);
    return Buffer.concat([Buffer.from([key.length]), key, Buffer.from([7]), length, text]);
  }));
  const body = Buffer.from(payload);
  const total = 12 + encodedHeaders.length + body.length + 4;
  const prelude = Buffer.alloc(8); prelude.writeUInt32BE(total, 0); prelude.writeUInt32BE(encodedHeaders.length, 4);
  const preludeCrc = Buffer.alloc(4); preludeCrc.writeUInt32BE(crc32(prelude));
  const message = Buffer.concat([prelude, preludeCrc, encodedHeaders, body]);
  const messageCrc = Buffer.alloc(4); messageCrc.writeUInt32BE(crc32(message));
  return Buffer.concat([message, messageCrc]);
}

const result = value => eventMessage({ ':message-type': 'event', ':event-type': 'result', ':content-type': 'application/json' }, JSON.stringify(value));

/**
 * @param {{ accessPoints: Record<string, string>, codeInterpreterIdentifier?: string }} options
 * @returns {Promise<{ endpoint: string, calls: object[], sessions: Map<string, object>, expire(sessionId: string): void, client(): Promise<object>, close(): Promise<void> }>}
 */
export async function startFakeCodeInterpreter({ accessPoints, codeInterpreterIdentifier = 'fictional-interpreter-0001' }) {
  const sessions = new Map(), calls = [];
  const fail = (outgoing, status, type, message) => outgoing.writeHead(status, { 'content-type': 'application/json', 'x-amzn-errortype': type }).end(JSON.stringify({ message }));

  function run(session, command) {
    const { directory, mountPath } = session;
    const local = command.split(mountPath).join(directory);
    const task = { id: randomUUID(), stdout: '', stderr: '', status: 'working', exitCode: undefined };
    const child = spawn('bash', ['-c', local], { cwd: directory, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: directory, LANG: 'C.UTF-8' } });
    const back = text => text.split(directory).join(mountPath);
    child.stdout.on('data', chunk => { task.stdout += back(chunk.toString()); });
    child.stderr.on('data', chunk => { task.stderr += back(chunk.toString()); });
    child.on('close', (code, signal) => { if (task.status === 'working') { task.status = signal ? 'canceled' : 'completed'; task.exitCode = code ?? undefined; } });
    child.on('error', error => { task.status = 'failed'; task.stderr += String(error.message); });
    task.stop = () => { if (task.status !== 'working') return; task.status = 'canceled'; try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } };
    session.tasks.set(task.id, task);
    return task;
  }
  const structured = task => ({ taskId: task.id, taskStatus: task.status, stdout: task.stdout, stderr: task.stderr, ...(task.exitCode === undefined ? {} : { exitCode: task.exitCode }) });

  const server = createServer(async (incoming, outgoing) => {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const url = new URL(incoming.url, 'http://fake.invalid');
    const route = /^\/code-interpreters\/([^/]+)\/(sessions\/start|sessions\/stop|tools\/invoke)$/.exec(url.pathname);
    if (!route) return fail(outgoing, 404, 'UnknownOperationException', 'Unknown operation');
    if (decodeURIComponent(route[1]) !== codeInterpreterIdentifier) return fail(outgoing, 404, 'ResourceNotFoundException', 'Unknown code interpreter');
    if (route[2] === 'sessions/start' && incoming.method === 'PUT') {
      const mounts = (body.filesystemConfigurations ?? []).map(entry => entry.efsConfiguration).filter(Boolean);
      calls.push({ operation: 'StartCodeInterpreterSession', filesystemConfigurations: body.filesystemConfigurations ?? [] });
      if (mounts.length !== 1) return fail(outgoing, 400, 'ValidationException', 'This fake mounts exactly one EFS access point');
      const directory = accessPoints[mounts[0].accessPointArn];
      if (!directory) return fail(outgoing, 404, 'ResourceNotFoundException', 'Unknown access point');
      const sessionId = `fictional-session-${randomUUID()}`;
      sessions.set(sessionId, { id: sessionId, directory, mountPath: mounts[0].mountPath, accessPointArn: mounts[0].accessPointArn, tasks: new Map(), live: true });
      return outgoing.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ codeInterpreterIdentifier, sessionId, createdAt: new Date().toISOString() }));
    }
    if (route[2] === 'sessions/stop' && incoming.method === 'PUT') {
      const session = sessions.get(url.searchParams.get('sessionId'));
      calls.push({ operation: 'StopCodeInterpreterSession', sessionId: url.searchParams.get('sessionId') });
      if (!session?.live) return fail(outgoing, 404, 'ResourceNotFoundException', 'Unknown session');
      session.live = false; for (const task of session.tasks.values()) task.stop();
      return outgoing.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ codeInterpreterIdentifier, sessionId: session.id, lastUpdatedAt: new Date().toISOString() }));
    }
    const session = sessions.get(incoming.headers['x-amzn-code-interpreter-session-id']);
    calls.push({ operation: 'InvokeCodeInterpreter', name: body.name, sessionId: session?.id });
    if (!session?.live) return fail(outgoing, 404, 'ResourceNotFoundException', 'The session does not exist or has expired');
    const args = body.arguments ?? {};
    let value;
    if (body.name === 'startCommandExecution') { const task = run(session, String(args.command ?? '')); value = { content: [{ type: 'text', text: `Started task ${task.id}` }], structuredContent: { taskId: task.id, taskStatus: 'submitted' } }; }
    else if (body.name === 'getTask' || body.name === 'stopTask') {
      const task = session.tasks.get(args.taskId);
      if (!task) value = { content: [{ type: 'text', text: 'Unknown task' }], isError: true };
      else { if (body.name === 'stopTask') task.stop(); value = { content: [{ type: 'text', text: task.status }], structuredContent: structured(task) }; }
    } else return fail(outgoing, 400, 'ValidationException', `This fake does not implement ${body.name}`);
    outgoing.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream', 'x-amzn-code-interpreter-session-id': session.id });
    outgoing.end(result(value));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  return {
    endpoint, calls, sessions, codeInterpreterIdentifier,
    /** The service ends a session on its own (timeout): later calls answer ResourceNotFoundException. */
    expire: sessionId => { const session = sessions.get(sessionId); if (session) { session.live = false; for (const task of session.tasks.values()) task.stop(); } },
    /** The real SDK client, pointed at this server with fictional static keys (never real credentials). */
    client: async () => {
      const { BedrockAgentCoreClient } = await import('@aws-sdk/client-bedrock-agentcore');
      return new BedrockAgentCoreClient({ region: 'us-east-1', endpoint, credentials: { accessKeyId: 'FICTIONALKEYID', secretAccessKey: 'fictional-secret' }, maxAttempts: 1 });
    },
    close: async () => {
      for (const session of sessions.values()) for (const task of session.tasks.values()) task.stop();
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    },
  };
}
