import { execFileSync } from 'node:child_process'

const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

const generatedArtifactRules: Array<{ name: string; pattern: RegExp }> = [
  { name: 'dist output', pattern: /(^|\/)dist\// },
  { name: 'vite dependency cache', pattern: /(^|\/)node_modules\/\.vite\// },
  { name: 'CLI public build output', pattern: /^packages\/cli\/public\// },
  { name: 'full-app generated API bundle', pattern: /^apps\/full-app\/api\/generated-index\.(?:ts|js|js\.map|ts\.map)$/ },
  { name: 'full-app generated API sourcemap', pattern: /^apps\/full-app\/api\/index\.ts\.map$/ },
  { name: 'app API sourcemap', pattern: /^apps\/[^/]+\/api\/.*\.map$/ },
  { name: 'test result artifact', pattern: /(^|\/)test-results\// },
  { name: 'e2e artifact', pattern: /(^|\/)e2e-artifacts\// },
  { name: 'TypeScript build info', pattern: /(^|\/)(?:.*\.tsbuildinfo|\.tsbuildinfo(?:\..*)?)$/ },
  { name: 'package-local vendored node_modules', pattern: /^packages\/[^/]+\/lib\/node_modules\// },
]

const violations = trackedFiles.flatMap((file) =>
  generatedArtifactRules
    .filter((rule) => rule.pattern.test(file))
    .map((rule) => ({ file, rule: rule.name })),
)

if (violations.length > 0) {
  console.error('Generated/build artifacts are tracked. Remove them from git and keep them ignored.\n')
  for (const { file, rule } of violations) {
    console.error(`- ${file} (${rule})`)
  }
  process.exit(1)
}

console.log('generated-artifacts: OK')
