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
  READONLY_PROJECTION_BINDING_NOT_FOUND_CODE,
  READONLY_PROJECTION_INVALID_PATH_CODE,
  READONLY_PROJECTION_MUTATION_CODE,
  ReadonlyProjectionOperationError,
  createReadonlyProjectionOperations,
} from "./readonlyProjectionOperations";

export { checkReadonlyProjectionConformance } from "./testing/readonlyProjectionConformance";

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

export type {
  ReadonlyProjectionConformanceResult,
  ReadonlyProjectionConformanceSubject,
  ReadonlyProjectionConformanceOperations,
  ReadonlyProjectionProbe,
} from "./testing/readonlyProjectionConformance";

export type {
  BoundFilesystemContext,
  FilesystemBinding,
  FilesystemBindingProvider,
  FilesystemBindingResolver,
  FilesystemId,
  PreparedFilesystemBinding,
  RuntimeBindingPlan,
} from "../shared/index";
