/**
 * Example: Batch analyze all Cargo.toml files in a workspace
 *
 * Run with: node dist/examples/batch-analysis.cjs ./my-workspace
 */

import { writeFile } from 'node:fs/promises'
import { validateBatch, exportBatchToJson, toJsonWithSummary } from '../src/api/index'

async function main() {
  const rootDir = process.argv[2] || '.'

  console.log(`Analyzing all Cargo.toml files in ${rootDir}...\n`)

  const result = await validateBatch({
    rootDir,
    pattern: '**/Cargo.toml',
    useCargoCache: true,
    concurrency: 5,
    logger: {
      debug: () => {}, // Disable debug logs
      info: (msg) => console.log(msg),
      warn: (msg) => console.warn(`[WARN] ${msg}`),
      error: (msg) => console.error(`[ERROR] ${msg}`),
    },
  })

  console.log('\n=== Batch Analysis Summary ===')
  console.log(`Total crates analyzed: ${result.totalFiles}`)
  console.log(`Total dependencies: ${result.totalDependencies}`)
  console.log(`✓ Latest: ${result.summary.latest}`)
  console.log(`⚠ Patch behind: ${result.summary.patchBehind}`)
  console.log(`⚠ Minor behind: ${result.summary.minorBehind}`)
  console.log(`⚠ Major behind: ${result.summary.majorBehind}`)
  console.log(`✗ Errors: ${result.summary.errors}`)

  if (result.errors.length > 0) {
    console.log(`\nFailed to analyze ${result.errors.length} files:`)
    for (const error of result.errors) {
      console.log(`  - ${error.path}: ${error.error.message}`)
    }
  }

  // Export to JSON file
  const jsonOutput = exportBatchToJson(result, true)
  const outputPath = 'dependency-analysis.json'
  await writeFile(outputPath, jsonOutput, 'utf-8')
  console.log(`\nFull report exported to ${outputPath}`)

  // Find crates with most outdated dependencies
  const cratesWithIssues = result.results
    .map((r) => {
      const json = toJsonWithSummary(r)
      const outdated = json.dependencies.filter(
        (d) => d.status === 'major-behind' || d.status === 'minor-behind' || d.status === 'patch-behind',
      )
      return { path: r.filePath, count: outdated.length, outdated }
    })
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)

  if (cratesWithIssues.length > 0) {
    console.log('\n=== Crates with most outdated dependencies ===')
    for (const crate of cratesWithIssues.slice(0, 10)) {
      console.log(`\n${crate.path} (${crate.count} outdated)`)
      for (const dep of crate.outdated.slice(0, 5)) {
        const current = dep.currentVersion || '?'
        const latest = dep.latestStable || dep.latest || '?'
        console.log(`  - ${dep.name}: ${current} → ${latest} (${dep.status})`)
      }
    }
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
