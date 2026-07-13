import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { D1_CADDY_AMD64_ID, D1_CADDY_COMMAND, D1_CADDY_IMAGE, D1_CADDY_IMAGE_DEFAULTS, D1_CADDYFILE_DIGEST, } from '../src/server/deployment/d1IngressArtifacts.js';
export const D1_INGRESS_PROOF_HELPER_IMAGE = 'node@sha256:c601a46abb4d2ab80a9dc3da208d50d1122642d53f17a101926ace71e5a9bf1c';
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CADDYFILE = path.join(REPOSITORY_ROOT, 'deploy/d1/Caddyfile');
const CADDYFILE_TARGET = '/etc/caddy/Caddyfile';
const AUTHORITY = 'insurance.example.test:8443';
const MAX_OUTPUT = 1024 * 1024;
const FAILURE = `${JSON.stringify({ status: 'fail', proof: 'd1-ingress-headers', error: 'D1_INGRESS_HEADER_PROOF_FAILED' })}\n`;
const ECHO = "require('node:http').createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({host:req.headers.host,distinct:req.headersDistinct,raw:req.rawHeaders}))}).listen(3000,'0.0.0.0')";
export const D1_INGRESS_PROOF_CASES = Object.freeze([
    { name: 'forwarded-absent', forwarded: [], xfh: [] },
    { name: 'forwarded-single', forwarded: ['for=192.0.2.1;host=evil.example'], xfh: [] },
    { name: 'forwarded-empty', forwarded: [''], xfh: [] },
    { name: 'forwarded-repeated', forwarded: ['for=192.0.2.1', 'for=192.0.2.2'], xfh: [] },
    { name: 'forwarded-comma', forwarded: ['for=192.0.2.1, for=192.0.2.2'], xfh: [] },
    { name: 'xfh-absent', forwarded: [], xfh: [] },
    { name: 'xfh-hostile', forwarded: [], xfh: ['evil.example'] },
    { name: 'xfh-repeated', forwarded: [], xfh: ['evil.example', 'second.example'] },
    { name: 'xfh-comma', forwarded: [], xfh: ['evil.example, second.example'] },
]);
function docker(args) {
    const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: MAX_OUTPUT, timeout: 120_000, shell: false });
    return { ok: result.status === 0, stdout: result.stdout ?? '' };
}
function requireDocker(args) {
    const result = docker(args);
    if (!result.ok || new TextEncoder().encode(result.stdout).byteLength > MAX_OUTPUT)
        throw new Error('docker');
    return result.stdout;
}
function records(raw) {
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'object' || entry === null))
        throw new Error('inspect');
    return value;
}
export function validateD1CaddyImageInspect(raw) {
    const image = records(raw)[0];
    if (!image || image.Id !== D1_CADDY_AMD64_ID || !Array.isArray(image.RepoDigests) || !image.RepoDigests.includes(D1_CADDY_IMAGE)
        || image.Config?.Entrypoint != null || JSON.stringify(image.Config?.Cmd) !== JSON.stringify(D1_CADDY_COMMAND)
        || !Array.isArray(image.Config?.Env) || Object.entries(D1_CADDY_IMAGE_DEFAULTS)
        .some(([key, value]) => !image.Config.Env.includes(`${key}=${value}`)))
        throw new Error('image');
}
export function validateD1IngressContainerInspect(raw, source) {
    const container = records(raw)[0];
    const mount = container?.Mounts?.filter((entry) => entry.Destination === CADDYFILE_TARGET);
    if (!container || container.Config?.Image !== D1_CADDY_IMAGE
        || JSON.stringify(container.Config?.Cmd) !== JSON.stringify(D1_CADDY_COMMAND)
        || !Array.isArray(mount) || mount.length !== 1 || mount[0].Type !== 'bind' || mount[0].Source !== source || mount[0].RW !== false)
        throw new Error('container');
}
function rawValues(raw, name) {
    if (!Array.isArray(raw) || raw.some((value) => typeof value !== 'string') || raw.length % 2 !== 0)
        throw new Error('headers');
    const values = [];
    for (let index = 0; index < raw.length; index += 2)
        if (raw[index].toLowerCase() === name)
            values.push(raw[index + 1]);
    return values;
}
export function assertD1IngressEcho(raw, authority = AUTHORITY) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        throw new Error('echo');
    const echo = raw;
    if (echo.host !== authority || rawValues(echo.raw, 'host').join('\0') !== authority
        || rawValues(echo.raw, 'x-forwarded-host').join('\0') !== authority || rawValues(echo.raw, 'forwarded').length !== 0
        || JSON.stringify(echo.distinct?.['x-forwarded-host']) !== JSON.stringify([authority])
        || Object.hasOwn(echo.distinct ?? {}, 'forwarded'))
        throw new Error('echo');
}
async function echoRequest(port, forwarded, xfh) {
    const headers = ['Host', AUTHORITY];
    for (const value of forwarded)
        headers.push('Forwarded', value);
    for (const value of xfh)
        headers.push('X-Forwarded-Host', value);
    return new Promise((resolve, reject) => {
        const call = request({ host: '127.0.0.1', port, path: '/proof', headers, method: 'GET', timeout: 2_000 }, (response) => {
            const chunks = [];
            let size = 0;
            response.on('data', (chunk) => { size += chunk.length; if (size > 64 * 1024)
                response.destroy();
            else
                chunks.push(chunk); });
            response.on('error', reject);
            response.on('end', () => {
                if (response.statusCode !== 200)
                    reject(new Error('status'));
                else {
                    try {
                        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                    }
                    catch {
                        reject(new Error('json'));
                    }
                }
            });
        });
        call.on('timeout', () => call.destroy(new Error('timeout')));
        call.on('error', reject);
        call.end();
    });
}
async function waitForEcho(port, forwarded, xfh) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
            return await echoRequest(port, forwarded, xfh);
        }
        catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    throw new Error('readiness');
}
function cleanup(names, network, label) {
    for (const name of names)
        docker(['rm', '-f', name]);
    docker(['network', 'rm', network]);
    const containers = docker(['container', 'ls', '-a', '--filter', `label=${label}`, '--format', '{{.Names}}']);
    const networks = docker(['network', 'ls', '--filter', `label=${label}`, '--format', '{{.Name}}']);
    if (!containers.ok || !networks.ok || containers.stdout.trim() !== '' || networks.stdout.trim() !== '')
        throw new Error('cleanup');
}
async function proof() {
    const token = randomUUID();
    const label = `ai.senecapp.d1-ingress-proof=${token}`;
    const network = `d1-ingress-${token}`;
    const backend = `${network}-backend`;
    const ingress = `${network}-caddy`;
    const validator = `${network}-validate`;
    const names = [backend, ingress, validator];
    let cleaned = false;
    const clean = () => { if (!cleaned) {
        cleaned = true;
        cleanup(names, network, label);
    } };
    const onSignal = () => { try {
        clean();
    }
    finally {
        process.stdout.write(FAILURE);
        process.exit(1);
    } };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    try {
        const config = await readFile(CADDYFILE);
        if (`sha256:${createHash('sha256').update(config).digest('hex')}` !== D1_CADDYFILE_DIGEST)
            throw new Error('configDigest');
        requireDocker(['pull', D1_CADDY_IMAGE]);
        requireDocker(['pull', D1_INGRESS_PROOF_HELPER_IMAGE]);
        validateD1CaddyImageInspect(requireDocker(['image', 'inspect', D1_CADDY_IMAGE]));
        const helper = records(requireDocker(['image', 'inspect', D1_INGRESS_PROOF_HELPER_IMAGE]))[0];
        if (!helper?.RepoDigests?.includes(D1_INGRESS_PROOF_HELPER_IMAGE))
            throw new Error('helperImage');
        const mount = `type=bind,src=${CADDYFILE},dst=${CADDYFILE_TARGET},readonly`;
        requireDocker(['run', '--rm', '--name', validator, '--label', label, '--mount', mount, D1_CADDY_IMAGE,
            'caddy', 'validate', '--config', CADDYFILE_TARGET, '--adapter', 'caddyfile']);
        requireDocker(['network', 'create', '--label', label, network]);
        requireDocker(['run', '-d', '--rm', '--name', backend, '--label', label, '--network', network, '--network-alias', 'core-app',
            '--entrypoint', 'node', D1_INGRESS_PROOF_HELPER_IMAGE, '-e', ECHO]);
        requireDocker(['run', '-d', '--rm', '--name', ingress, '--label', label, '--network', network, '--publish', '127.0.0.1::8080',
            '--mount', mount, D1_CADDY_IMAGE, ...D1_CADDY_COMMAND]);
        validateD1IngressContainerInspect(requireDocker(['inspect', ingress]), CADDYFILE);
        const published = requireDocker(['port', ingress, '8080/tcp']).trim().match(/^127\.0\.0\.1:(\d+)$/);
        if (!published)
            throw new Error('port');
        for (const testCase of D1_INGRESS_PROOF_CASES)
            assertD1IngressEcho(await waitForEcho(Number(published[1]), testCase.forwarded, testCase.xfh));
    }
    finally {
        try {
            clean();
        }
        finally {
            process.off('SIGINT', onSignal);
            process.off('SIGTERM', onSignal);
        }
    }
    process.stdout.write(`${JSON.stringify({ status: 'pass', proof: 'd1-ingress-headers', caddyImage: D1_CADDY_IMAGE,
        caddyImageId: D1_CADDY_AMD64_ID, caddyfileDigest: D1_CADDYFILE_DIGEST, cases: D1_INGRESS_PROOF_CASES.length })}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    proof().catch(() => { process.stdout.write(FAILURE); process.exitCode = 1; });
}
