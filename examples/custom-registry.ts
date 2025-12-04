/**
 * Example: Analyze crates with custom/private registry
 *
 * Run with: node dist/examples/custom-registry.cjs
 */

import { validateCrate, toJsonWithSummary } from '../src/api/index'

async function main() {
  const cargoTomlPath = process.argv[2] || './Cargo.toml'

  console.log(`Analyzing ${cargoTomlPath} with custom registry...\n`)

  const result = await validateCrate(cargoTomlPath, {
    useCargoCache: true,
    // Add custom/private registries
    registries: [
      {
        name: 'my-company-registry',
        index: 'https://registry.mycompany.com/index/',
        // Optional: specify cache directory
        // cache: 'my-company-registry-abc123',
        // Optional: authentication token
        // token: process.env.REGISTRY_TOKEN,
      },
      {
        name: 'local-registry',
        index: 'file:///path/to/local/registry/',
      },
    ],
    logger: {
      debug: () => {},
      info: (msg) => console.log(`[INFO] ${msg}`),
      warn: (msg) => console.warn(`[WARN] ${msg}`),
      error: (msg) => console.error(`[ERROR] ${msg}`),
    },
  })

  const json = toJsonWithSummary(result)

  // Group dependencies by registry
  const byRegistry = new Map<string, typeof json.dependencies>()
  byRegistry.set('crates.io', [])

  for (const dep of json.dependencies) {
    const registry = dep.registry || 'crates.io'
    if (!byRegistry.has(registry)) {
      byRegistry.set(registry, [])
    }
    byRegistry.get(registry)?.push(dep)
  }

  console.log('\n=== Dependencies by Registry ===')
  for (const [registry, deps] of byRegistry.entries()) {
    console.log(`\n${registry}: ${deps.length} dependencies`)
    const outdated = deps.filter(
      (d) => d.status === 'patch-behind' || d.status === 'minor-behind' || d.status === 'major-behind',
    )
    if (outdated.length > 0) {
      console.log(`  Outdated: ${outdated.length}`)
      for (const dep of outdated) {
        console.log(`    - ${dep.name}: ${dep.currentVersion} → ${dep.latestStable || dep.latest}`)
      }
    }
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
