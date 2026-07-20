export {
  COMPANY_CONTEXT_FILESYSTEM_ID,
  COMPANY_CONTEXT_SENTINEL,
  DEFAULT_COMPANY_CONTEXT_FIXTURE_FILES,
  FixtureCompanyContextBindingProvider,
  listFixtureProjectionFiles,
  readFixtureProjectionFile,
  seedCompanyContextFixture,
} from "./testing/companyContextFixtureProvider";

export {
  MANAGEMENT_PROJECTION_BINDING_REQUIRED_CODE,
  MANAGEMENT_PROJECTION_INVALID_PATH_CODE,
  ManagementProjectionOperationError,
  createManagementProjectionOperations,
} from "./managementProjectionOperations";

export {
  READONLY_PROJECTION_BINDING_NOT_FOUND_CODE,
  READONLY_PROJECTION_INVALID_PATH_CODE,
  READONLY_PROJECTION_MUTATION_CODE,
  ReadonlyProjectionOperationError,
  createReadonlyProjectionOperations,
} from "./readonlyProjectionOperations";

export type {
  ManagementProjectionOperationMetadata,
  ManagementProjectionOperations,
} from "./managementProjectionOperations";

export type {
  ReadonlyProjectionOperationMetadata,
  FilesystemPathDescriptor,
  ReadonlyProjectionOperations,
} from "./readonlyProjectionOperations";

export type {
  CompanyContextFixtureFile,
  CompanyContextFixturePreparedBinding,
  CompanyContextFixturePreparedHandle,
  CompanyContextFixturePreparedLifecycle,
  CompanyContextFixtureProjectionPolicy,
  CompanyContextFixtureProviderOptions,
} from "./testing/companyContextFixtureProvider";

export {
  ScopedFilesystemRuntimeBindingManager,
  filesystemRuntimeScopeKey,
} from "./runtimeBindingManager";

export { checkReadonlyProjectionConformance } from "./testing/readonlyProjectionConformance";

export type {
  FilesystemRuntimeLifecycleEvent,
  PreparedBindingSelector,
  ScopedFilesystemRuntimeBindingManagerOptions,
  ScopedPreparedFilesystemBinding,
  ScopedRuntimeBindingPlan,
} from "./runtimeBindingManager";

export type {
  ReadonlyProjectionConformanceResult,
  ReadonlyProjectionConformanceSubject,
  ReadonlyProjectionConformanceOperations,
  ReadonlyProjectionProbe,
} from "./testing/readonlyProjectionConformance";

export {
  ERROR_CODE_NOT_FOUND_OR_DENIED,
  ERROR_CODE_READONLY,
  fileRoutes,
} from './routes/file'
export { fsEventsRoutes } from './routes/fsEvents'
export { gitRoutes } from './routes/git'
export { searchRoutes } from './routes/search'
export { treeRoutes } from './routes/tree'

export type { GitRouteOptions } from './routes/git'
export type { SearchRouteOptions } from './routes/search'

export {
  FileRecordsValidationError,
  MAX_RECORD_FILE_BYTES,
  buildFileRecordsResult,
  parseFileRecordsRequest,
} from './routes/fileRecords'
export type {
  FileRecord,
  FileRecordsFormat,
  FileRecordsRequest,
  FileRecordsResult,
} from './routes/fileRecords'

export { createFsEventBroadcaster } from './routes/fsEventBroadcaster'
export type {
  FsEventBroadcaster,
  FsEventEnvelope,
  FsSubscribeResult,
} from './routes/fsEventBroadcaster'

export { buildGitFileUrl } from './git/buildGitFileUrl'
export { __gitTestUtils, resolveGitFileUrl } from './git/gitFileUrl'
export type { GitFileUrlResult } from './git/gitFileUrl'

export { DEFAULT_IGNORED_DIR_NAMES, isIgnoredDirName } from './routes/ignore'
export { createLogger } from './routes/logging'
export type { LogFields, Logger } from './routes/logging'

export {
  assertReadonlySkillFileConfined,
  isReadonlySkillFilePath,
  readReadonlySkillFile,
  statReadonlySkillFile,
} from './routes/readonlySkillFiles'
export type { ReadonlySkillFileStat } from './routes/readonlySkillFiles'

export {
  assertRealPathWithinWorkspace,
  ensureExistingWorkspacePath,
  ensureWritableWorkspacePath,
  validatePath,
} from './workspace/paths'
export type { PathRejectReason, PathValidationError } from './workspace/paths'

export type {
  BoundFilesystemContext,
  FilesystemBinding,
  FilesystemBindingProvider,
  FilesystemBindingResolver,
  FilesystemId,
  PreparedFilesystemBinding,
  RuntimeBindingPlan,
} from "../shared/index";
