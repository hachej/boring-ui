import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmdirSync } from 'node:fs';
import { lstat, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const DESTINATION = '/run/boring/agent-host';
const LABEL = 'ai.senecapp.agent-host-boundary-proof=true';
const APP_ID = 10001;
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SETUP = String.raw `
const fs = require('fs'), crypto = require('crypto'), path = require('path')
const root = '/fixture', owner = Number(process.env.PROOF_OWNER_UID)
fs.chmodSync(root, 0o700)
let control
for (const hostId of ['host-a', 'host-b']) {
  const raw = 'raw-' + crypto.randomBytes(24).toString('hex')
  const ref = 'ref-' + crypto.randomBytes(24).toString('hex')
  const revision = path.join(root, hostId, 'revisions/r0000000001')
  const binding = path.join(revision, 'bindings/insurance')
  fs.mkdirSync(binding, { recursive: true })
  const manifest = { schemaVersion: 1, domain: 'boring-agent-host-binding-secrets:v1', hostId, revisionId: 'r0000000001', desiredStateDigest: 'sha256:' + 'a'.repeat(64), bindings: [{ bindingId: 'insurance', runtimeInputsDigest: 'sha256:' + 'b'.repeat(64), secrets: [{ secretRef: ref, providerVersionFingerprint: 'sha256:' + 'c'.repeat(64), file: 'bindings/insurance/0000' }] }] }
  const secret = path.join(binding, '0000'), manifestFile = path.join(revision, 'manifest.json')
  fs.writeFileSync(secret, raw); fs.writeFileSync(manifestFile, JSON.stringify(manifest))
  for (const directory of [path.join(root, hostId), path.join(root, hostId, 'revisions'), revision, path.join(revision, 'bindings'), binding]) {
    fs.chownSync(directory, owner, 10001); fs.chmodSync(directory, 0o710)
  }
  fs.chownSync(secret, 10001, 10001); fs.chmodSync(secret, 0o400)
  fs.chownSync(manifestFile, owner, 10001); fs.chmodSync(manifestFile, 0o440)
  if (hostId === 'host-a') control = { raw, ref }
}
const controlFile = path.join(root, 'proof-control.json')
fs.writeFileSync(controlFile, JSON.stringify(control)); fs.chownSync(controlFile, owner, owner); fs.chmodSync(controlFile, 0o600)
`;
const CLEANUP = String.raw `
const fs = require('fs'), path = require('path')
for (const entry of fs.readdirSync('/fixture')) fs.rmSync(path.join('/fixture', entry), { recursive: true, force: true })
`;
const TARGET = String.raw `
const fs = require('fs')
const revision = '/run/boring/agent-host/revisions/r0000000001', secret = revision + '/bindings/insurance/0000'
const raw = fs.readFileSync(secret), secretStat = fs.statSync(secret)
const manifest = JSON.parse(fs.readFileSync(revision + '/manifest.json', 'utf8'))
const ref = Buffer.from(manifest.bindings[0].secrets[0].secretRef)
const status = fs.readFileSync('/proc/1/status', 'utf8')
const ids = key => status.match(new RegExp('^' + key + ':\\s+(\\d+)\\s+(\\d+)', 'm')).slice(1).map(Number)
const ownedDirectory = value => { const stat = fs.statSync(value); return stat.isDirectory() && stat.uid === 10001 && stat.gid === 10001 }
const denied = {}
for (const [key, operation] of Object.entries({ write: () => fs.writeFileSync(secret, Buffer.from('x')), chmod: () => fs.chmodSync(secret, 0o600), unlink: () => fs.unlinkSync(secret) })) {
  try { operation(); denied[key] = false } catch { denied[key] = true }
}
const absent = value => { try { fs.accessSync(value); return false } catch { return true } }
const environ = fs.readFileSync('/proc/1/environ'), cmdline = fs.readFileSync('/proc/1/cmdline')
const procClean = !environ.includes(raw) && !environ.includes(ref) && !cmdline.includes(raw) && !cmdline.includes(ref)
console.log(JSON.stringify({ status: 'pass', uid: ids('Uid').slice(0, 2), gid: ids('Gid').slice(0, 2), rootsReady: ownedDirectory(process.env.BORING_AGENT_WORKSPACE_ROOT) && ownedDirectory(process.env.BORING_AGENT_SESSION_ROOT), read: raw.length > 0, canaryMode: secretStat.uid === 10001 && secretStat.gid === 10001 && (secretStat.mode & 0o777) === 0o400, denied, hostBAbsent: absent('/run/boring/agent-host/host-b'), baseAbsent: absent('/run/boring/agent-host/proof-control.json'), procClean }))
setInterval(() => {}, 2147483647)
`;
function docker(args) {
    const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1024 * 1024, shell: false });
    return { ok: result.status === 0, stdout: result.stdout ?? '' };
}
function requireDocker(args) {
    const result = docker(args);
    if (!result.ok)
        throw new Error('docker');
    return result.stdout;
}
function mount(source) { return `type=bind,src=${source},dst=${DESTINATION},readonly`; }
export function parsePinnedImage(argv, env) {
    const args = argv[0] === '--' ? argv.slice(1) : argv;
    const image = args.length === 0 ? env.AGENT_HOST_DOCKER_PROOF_IMAGE : args.length === 2 && args[0] === '--image' ? args[1] : undefined;
    if (!image || !/^(?:sha256:[a-f0-9]{64}|[^\s]+@sha256:[a-f0-9]{64})$/.test(image))
        throw new Error('image');
    return image;
}
export function targetRunArgs(image, name, source) {
    return ['run', '-d', '--rm', '--name', name, '--label', LABEL,
        '--env', `BORING_AGENT_WORKSPACE_ROOT=/tmp/${name}-workspaces`, '--env', `BORING_AGENT_SESSION_ROOT=/tmp/${name}-sessions`,
        '--mount', mount(source), image, 'node', '-e', TARGET];
}
export function assertContainersAbsent(names, run = docker) {
    for (const name of names) {
        const result = run(['container', 'ls', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']);
        if (!result.ok || result.stdout.trim() !== '')
            throw new Error('containerCleanup');
    }
}
export function validateInspect(raw, source, secrets, repositoryRoot) {
    const record = JSON.parse(raw)[0];
    const mounts = record?.Mounts;
    if (!record || !Array.isArray(mounts) || mounts.length !== 1)
        throw new Error('inspect');
    const actual = mounts[0];
    if (actual?.Type !== 'bind' || actual.Source !== source || actual.Destination !== DESTINATION || actual.RW !== false)
        throw new Error('mount');
    const relative = path.relative(repositoryRoot, source);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)))
        throw new Error('repositoryMount');
    const serialized = JSON.stringify({ Config: record.Config, Mounts: record.Mounts });
    if (secrets.some((secret) => serialized.includes(secret)))
        throw new Error('secret');
}
function assertTargetResult(raw) {
    const result = JSON.parse(raw.trim());
    if (result.status !== 'pass' || JSON.stringify(result.uid) !== `[${APP_ID},${APP_ID}]` || JSON.stringify(result.gid) !== `[${APP_ID},${APP_ID}]`
        || result.rootsReady !== true || result.read !== true || result.canaryMode !== true || result.hostBAbsent !== true || result.baseAbsent !== true || result.procClean !== true
        || result.denied?.write !== true || result.denied?.chmod !== true || result.denied?.unlink !== true)
        throw new Error('target');
}
async function waitForResult(name) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const result = docker(['logs', name]);
        if (result.ok && result.stdout.trim())
            return result.stdout;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('targetTimeout');
}
function cleanupResources(image, root, names, cleanupName) {
    for (const name of names)
        docker(['rm', '-f', name]);
    assertContainersAbsent(names);
    const cleaned = docker(['run', '--rm', '--name', cleanupName, '--label', LABEL, '--user', '0:0', '--mount', `type=bind,src=${root},dst=/fixture`, '--entrypoint', 'node', image, '-e', CLEANUP]);
    if (!cleaned.ok) {
        try {
            rmdirSync(root);
        }
        catch { }
        ;
        throw new Error('cleanupHelper');
    }
    assertContainersAbsent([...names, cleanupName]);
    try {
        rmdirSync(root);
    }
    catch {
        throw new Error('cleanup');
    }
}
async function proof(image) {
    const token = randomUUID();
    const root = await mkdtemp('/dev/shm/boring-agent-host-boundary-');
    const hostA = path.join(root, 'host-a');
    const hostB = path.join(root, 'host-b');
    const missing = path.join(root, 'missing');
    const target = `agent-host-boundary-${token}`;
    const missingName = `${target}-missing`;
    const helper = `${target}-helper`;
    const cleanup = `${target}-cleanup`;
    const names = [target, missingName, helper];
    let cleanupStarted = false;
    let interrupted;
    const clean = () => { if (!cleanupStarted) {
        cleanupStarted = true;
        cleanupResources(image, root, names, cleanup);
    } };
    const onSignal = (signal) => {
        interrupted = signal;
        if (cleanupStarted)
            return;
        try {
            clean();
        }
        finally {
            process.exit(signal === 'SIGINT' ? 130 : 143);
        }
    };
    const onSigint = () => onSignal('SIGINT');
    const onSigterm = () => onSignal('SIGTERM');
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    try {
        const imageInspect = JSON.parse(requireDocker(['image', 'inspect', image]))[0];
        if (JSON.stringify(imageInspect?.Config?.Entrypoint) !== JSON.stringify(['/usr/local/bin/web-entrypoint']))
            throw new Error('entrypoint');
        if (![undefined, '', '0', '0:0', 'root', 'root:root'].includes(imageInspect?.Config?.User))
            throw new Error('imageUser');
        requireDocker(['run', '--rm', '--name', helper, '--label', LABEL, '--user', '0:0', '-e', `PROOF_OWNER_UID=${process.getuid?.() ?? -1}`, '--mount', `type=bind,src=${root},dst=/fixture`, '--entrypoint', 'node', image, '-e', SETUP]);
        const control = JSON.parse(await readFile(path.join(root, 'proof-control.json'), 'utf8'));
        const missingResult = docker(['run', '--rm', '--name', missingName, '--label', LABEL, '--mount', mount(missing), image, 'node', '-e', 'process.exit(0)']);
        try {
            await lstat(missing);
            throw new Error('missingCreated');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        if (missingResult.ok)
            throw new Error('missingSource');
        requireDocker(targetRunArgs(image, target, hostA));
        const targetOutput = await waitForResult(target);
        assertTargetResult(targetOutput);
        const inspected = requireDocker(['inspect', target]);
        validateInspect(inspected, hostA, [control.raw, control.ref], REPOSITORY_ROOT);
        const record = JSON.parse(inspected)[0];
        if (JSON.stringify(record).includes(hostB) || record.Mounts.some((entry) => entry.Source === root))
            throw new Error('siblingMount');
    }
    finally {
        try {
            clean();
        }
        finally {
            process.off('SIGINT', onSigint);
            process.off('SIGTERM', onSigterm);
        }
    }
    if (interrupted) {
        process.exitCode = interrupted === 'SIGINT' ? 130 : 143;
        return;
    }
    process.stdout.write(`${JSON.stringify({ status: 'pass', proof: 'agent-host-docker-uid-dac', checks: { missingSource: true, exactHostMount: true, entrypointSetup: true, uidDrop: true, read0400: true, mutationsDenied: true, metadataRedacted: true, repositoryMountAbsent: true } })}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    Promise.resolve().then(() => proof(parsePinnedImage(process.argv.slice(2), process.env))).catch(() => {
        process.stdout.write(`${JSON.stringify({ status: 'fail', proof: 'agent-host-docker-uid-dac', error: 'AGENT_HOST_DOCKER_PROOF_FAILED' })}\n`);
        process.exitCode = 1;
    });
}
