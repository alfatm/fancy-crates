/**
 * Example: Analyze a single Cargo.toml file
 *
 * Run with: node dist/examples/single-crate.cjs
 */

import { validateCrate, toJsonWithSummary } from '../src/api/index'

async function main() {
  const cargoTomlPath = process.argv[2] || './Cargo.toml'

  console.log(`Analyzing ${cargoTomlPath}...\n`)

  const result = await validateCrate(cargoTomlPath, {
    useCargoCache: true,
    logger: {
      debug: (msg) => console.log(`[DEBUG] ${msg}`),
      info: (msg) => console.log(`[INFO] ${msg}`),
      warn: (msg) => console.warn(`[WARN] ${msg}`),
      error: (msg) => console.error(`[ERROR] ${msg}`),
    },
  })

  // Convert to JSON format with summary
  const json = toJsonWithSummary(result)

  console.log('\n=== Results ===')
  console.log(JSON.stringify(json, null, 2))

  console.log('\n=== Summary ===')
  console.log(`Total dependencies: ${json.summary.total}`)
  console.log(`✓ Latest: ${json.summary.latest}`)
  console.log(`⚠ Patch behind: ${json.summary.patchBehind}`)
  console.log(`⚠ Minor behind: ${json.summary.minorBehind}`)
  console.log(`⚠ Major behind: ${json.summary.majorBehind}`)
  console.log(`✗ Errors: ${json.summary.errors}`)

  // Find dependencies that need updates
  const needsUpdate = json.dependencies.filter(
    (d) => d.status === 'patch-behind' || d.status === 'minor-behind' || d.status === 'major-behind',
  )

  if (needsUpdate.length > 0) {
    console.log('\n=== Dependencies needing updates ===')
    for (const dep of needsUpdate) {
      console.log(
        `- ${dep.name}: ${dep.currentVersion || 'unknown'} → ${dep.latestStable || dep.latest} (${dep.status})`,
      )
    }
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
