// Prints what provisioning one user takes, from the same pure layout the host uses (no AWS call is made here):
// the `aws efs create-access-point` command for the user's folder, and the users.json entry the host reads.
//   node examples/aws/provision-user.mjs <userId (the token's sub)> <uid> <fileSystemId> <fileSystemArn>
// After running the printed command, put its AccessPointArn into the entry and merge it into /mnt/efs/state/users.json.
import { efsUserLayout } from '@hachej/boring-execution/aws-code-interpreter';

const [userId, uid, fileSystemId, fileSystemArn] = process.argv.slice(2);
if (!userId || !uid || !fileSystemId || !fileSystemArn) {
  console.error('Usage: node examples/aws/provision-user.mjs <userId> <uid> <fileSystemId> <fileSystemArn>');
  process.exit(2);
}
const layout = efsUserLayout({ userId, uid: Number(uid) });
const { rootDirectory, posixUser, creationInfo, tags } = layout.accessPoint;
const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
console.log([
  'aws efs create-access-point',
  `--file-system-id ${quote(fileSystemId)}`,
  `--client-token ${quote(`boring-${userId}`)}`,
  `--posix-user ${quote(JSON.stringify({ Uid: posixUser.uid, Gid: posixUser.gid }))}`,
  `--root-directory ${quote(JSON.stringify({ Path: rootDirectory, CreationInfo: { OwnerUid: creationInfo.ownerUid, OwnerGid: creationInfo.ownerGid, Permissions: creationInfo.permissions } }))}`,
  `--tags ${quote(JSON.stringify(tags.map(tag => ({ Key: tag.key, Value: tag.value }))))}`,
].join(' \\\n  '));
console.log(`\nusers.json entry:\n${JSON.stringify({ [userId]: { uid: Number(uid), accessPointArn: '<AccessPointArn from the command>', fileSystemArn } }, null, 2)}`);
