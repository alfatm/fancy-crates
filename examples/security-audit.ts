/**
 * Example: Security audit - find dependencies with errors or major version lag
 *
 * Run with: node dist/examples/security-audit.cjs ./workspace
 */

import { validateBatch } from '../src/api/index'

async function main() {
  const rootDir = process.argv[2] || '.'

  console.log(`Running security audit on ${rootDir}...\n`)

  const result = await validateBatch({
    rootDir,
    pattern: '**/Cargo.toml',
    useCargoCache: true,
    concurrency: 10,
    logger: {
      debug: () => {},
      info: () => {},
      warn: (msg) => console.warn(`[WARN] ${msg}`),
      error: (msg) => console.error(`[ERROR] ${msg}`),
    },
  })

  // Find critical issues
  const criticalIssues: Array<{ crate: string; dependency: string; issue: string }> = []

  for (const fileResult of result.results) {
    for (const dep of fileResult.dependencies) {
      // Flag dependencies with errors (couldn't fetch version info)
      if (dep.status === 'error') {
        criticalIssues.push({
          crate: fileResult.filePath,
          dependency: dep.name,
          issue: `Error: ${dep.error || 'Unknown error'}`,
        })
      }

      // Flag dependencies that are 2+ major versions behind
      if (dep.status === 'major-behind' && dep.currentVersion && dep.latestStable) {
        const current = dep.currentVersion.split('.')[0]
        const latest = dep.latestStable.split('.')[0]
        const versionGap = Number.parseInt(latest, 10) - Number.parseInt(current, 10)

        if (versionGap >= 2) {
          criticalIssues.push({
            crate: fileResult.filePath,
            dependency: dep.name,
            issue: `Severely outdated: ${dep.currentVersion} (latest: ${dep.latestStable}, ${versionGap} major versions behind)`,
          })
        }
      }
    }
  }

  console.log('=== Security Audit Results ===\n')
  console.log(`Total crates: ${result.totalFiles}`)
  console.log(`Total dependencies: ${result.totalDependencies}`)
  console.log(`Critical issues found: ${criticalIssues.length}`)

  if (criticalIssues.length > 0) {
    console.log('\n=== Critical Issues ===')
    for (const issue of criticalIssues) {
      console.log(`\n${issue.crate}`)
      console.log(`  ⚠ ${issue.dependency}: ${issue.issue}`)
    }

    // Exit with error code for CI/CD integration
    process.exit(1)
  } else {
    console.log('\n✓ No critical issues found!')
  }

  // Summary of update recommendations
  console.log('\n=== Update Recommendations ===')
  console.log(`Major updates recommended: ${result.summary.majorBehind}`)
  console.log(`Minor updates available: ${result.summary.minorBehind}`)
  console.log(`Patch updates available: ${result.summary.patchBehind}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
