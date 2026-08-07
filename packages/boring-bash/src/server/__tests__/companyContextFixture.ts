import type { FilesystemId } from "../../shared/index";
import {
  FixtureExternalContextBindingProvider,
  seedExternalContextFixture,
  type ExternalContextFixtureFile,
  type ExternalContextFixturePreparedHandle,
  type ExternalContextFixtureProviderOptions,
} from "../testing/externalContextFixtureProvider";

export const COMPANY_CONTEXT_FILESYSTEM_ID = "company_context" satisfies FilesystemId;
export const COMPANY_CONTEXT_SENTINEL = "FORBIDDEN_FINANCE_SECRET_123";

export const DEFAULT_COMPANY_CONTEXT_FIXTURE_FILES: readonly ExternalContextFixtureFile[] = [
  { path: "/company/hr/policy.md", content: "# HR policy\nVacation and onboarding policies.\n" },
  { path: "/company/hr/onboarding.md", content: "# Onboarding\nWelcome to the company.\n" },
  { path: "/company/finance/budget.md", content: `# Finance budget\n${COMPANY_CONTEXT_SENTINEL}\n` },
  { path: "/company/legal/contract.md", content: "# Legal contract\nStandard terms.\n" },
];

export type CompanyContextFixturePreparedHandle = ExternalContextFixturePreparedHandle;

export class FixtureCompanyContextBindingProvider extends FixtureExternalContextBindingProvider {
  constructor(options: Omit<ExternalContextFixtureProviderOptions, "filesystemId"> & { filesystemId?: FilesystemId }) {
    super({ ...options, filesystemId: options.filesystemId ?? COMPANY_CONTEXT_FILESYSTEM_ID });
  }
}

export async function seedCompanyContextFixture(root: string): Promise<void> {
  await seedExternalContextFixture(root, DEFAULT_COMPANY_CONTEXT_FIXTURE_FILES);
}

export { listFixtureProjectionFiles, readFixtureProjectionFile } from "../testing/externalContextFixtureProvider";
