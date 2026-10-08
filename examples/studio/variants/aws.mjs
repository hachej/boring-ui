// Variant `aws`: the same agent with its shell in an AgentCore Code Interpreter session and its files on the user's EFS folder,
// mounted both here and in the session (docs/architecture/HOST-RECIPE-AWS.md, @hachej/boring-execution/aws-code-interpreter).
// The studio has no AWS account, so this variant runs only against the offline fake (STUDIO_AWS=fake): the real AWS SDK
// client talks to ../../aws/fake-code-interpreter.mjs, and a directory in the data directory stands for the EFS file
// system. The file tools and the viewer read the folder on this side; commands run in the fake session over the same
// folder. The deployed recipe is examples/aws (its own server for AgentCore Runtime or ECS).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createCodeInterpreterEnv, efsUserLayout } from '@hachej/boring-execution/aws-code-interpreter';

const USER = 'studio-person', UID = 2001;
const ACCESS_POINT = 'arn:aws:elasticfilesystem:us-east-1:000000000000:access-point/fsap-00000000000000001';
const FILE_SYSTEM = 'arn:aws:elasticfilesystem:us-east-1:000000000000:file-system/fs-00000000000000001';

export default host => ({
  id: 'aws', title: 'AWS (fake Code Interpreter)', order: 90,
  description: 'Commands in an AgentCore Code Interpreter session, files on the user\'s EFS folder mounted on both sides. Offline: a fake Code Interpreter behind the real AWS SDK.',
  available: process.env.STUDIO_AWS === 'fake' ? true : { reason: 'Set STUDIO_AWS=fake to run it against the offline fake Code Interpreter; a real deployment is examples/aws (docs/architecture/HOST-RECIPE-AWS.md).' },
  capabilities: ['workspace', 'shell'],
  link: 'docs/architecture/HOST-RECIPE-AWS.md',
  async open() {
    const { startFakeCodeInterpreter } = await import('../../aws/fake-code-interpreter.mjs');
    const efs = join(host.directory, 'aws-efs');
    const layout = efsUserLayout({ userId: USER, uid: UID, runtimeMountPath: efs });
    mkdirSync(layout.runtime.root, { recursive: true });
    const fake = await startFakeCodeInterpreter({ accessPoints: { [ACCESS_POINT]: layout.runtime.root } });
    const interpreter = createCodeInterpreterEnv({ client: await fake.client(), codeInterpreterIdentifier: fake.codeInterpreterIdentifier, id: layout.namespaceId, pollIntervalMs: 100,
      session: { start: { name: 'studio', filesystemConfigurations: [layout.filesystemConfiguration({ accessPointArn: ACCESS_POINT, fileSystemArn: FILE_SYSTEM })] } },
      mount: { path: layout.interpreter.mountPath, root: layout.runtime.root } });
    return {
      env: interpreter.env, root: layout.interpreter.mountPath,
      close: async () => { await interpreter.stop(host.context).catch(() => {}); await fake.close(); },
    };
  },
});
