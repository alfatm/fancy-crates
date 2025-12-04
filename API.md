# Fancy Crates - Programmatic API

Fancy Crates provides a programmatic API for analyzing Cargo.toml dependencies. This is useful for:

- Batch analysis of multiple crates in a workspace
- CI/CD integration
- Custom tooling and automation
- Security auditing
- Dependency reporting

## Installation

```bash
npm install fancy-crates
```

## Quick Start

### Analyze a Single Crate

```typescript
import { validateCrate, toJsonWithSummary } from 'fancy-crates/api'

const result = await validateCrate('./Cargo.toml')
const json = toJsonWithSummary(result)

console.log(`Found ${json.summary.total} dependencies`)
console.log(`${json.summary.majorBehind} need major updates`)
```

### Batch Analysis

```typescript
import { validateBatch } from 'fancy-crates/api'

const result = await validateBatch({
  rootDir: './my-workspace',
  pattern: '**/Cargo.toml',
  concurrency: 5,
})

console.log(`Analyzed ${result.totalFiles} crates`)
console.log(`Total dependencies: ${result.totalDependencies}`)
```

## API Reference

### `validateCrate(filePath, options?)`

Validate a single Cargo.toml file.

**Parameters:**
- `filePath: string` - Path to Cargo.toml
- `options?: object` - Optional configuration
  - `useCargoCache?: boolean` - Use Cargo's local cache (default: true)
  - `registries?: RegistryConfig[]` - Additional registries
  - `logger?: Logger` - Custom logger for debug output

**Returns:** `Promise<ValidationResult>`

**Example:**
```typescript
const result = await validateCrate('./Cargo.toml', {
  useCargoCache: true,
  registries: [
    {
      name: 'my-registry',
      index: 'https://my-registry.com/index/',
    }
  ],
  logger: console, // Use console for logging
})
```

### `validateBatch(options)`

Validate multiple Cargo.toml files in a directory tree.

**Parameters:**
- `options: BatchValidationOptions`
  - `rootDir: string` - Root directory to search
  - `pattern?: string` - Glob pattern (default: `**/Cargo.toml`)
  - `useCargoCache?: boolean` - Use Cargo cache (default: true)
  - `registries?: RegistryConfig[]` - Additional registries
  - `logger?: Logger` - Custom logger
  - `concurrency?: number` - Max concurrent validations (default: 10)

**Returns:** `Promise<BatchValidationResult>`

**Example:**
```typescript
const result = await validateBatch({
  rootDir: './workspace',
  concurrency: 5,
  logger: {
    debug: () => {},
    info: console.log,
    warn: console.warn,
    error: console.error,
  },
})
```

### `toJson(result)`

Convert a single dependency result to JSON-friendly format.

**Parameters:**
- `result: DependencyValidationResult`

**Returns:** `DependencyResultJson`

### `toJsonWithSummary(result)`

Convert validation result to JSON with summary statistics.

**Parameters:**
- `result: ValidationResult`

**Returns:** `ValidationResultJson`

### `exportBatchToJson(result, pretty?)`

Export batch validation results to JSON string.

**Parameters:**
- `result: BatchValidationResult`
- `pretty?: boolean` - Pretty print (default: true)

**Returns:** `string`

## Types

### `ValidationResult`

```typescript
interface ValidationResult {
  filePath: string
  dependencies: DependencyValidationResult[]
  parseError?: Error
}
```

### `DependencyValidationResult`

```typescript
interface DependencyValidationResult {
  dependency: Dependency
  resolved: SemVer | null
  latestStable: SemVer | undefined
  latest: SemVer | undefined
  locked: SemVer | undefined
  error?: Error
  status: 'latest' | 'patch-behind' | 'minor-behind' | 'major-behind' | 'error'
}
```

### `BatchValidationResult`

```typescript
interface BatchValidationResult {
  totalFiles: number
  totalDependencies: number
  results: ValidationResult[]
  errors: Array<{ path: string; error: Error }>
  summary: {
    latest: number
    patchBehind: number
    minorBehind: number
    majorBehind: number
    errors: number
  }
}
```

### `DependencyResultJson`

```typescript
interface DependencyResultJson {
  name: string
  currentVersion?: string
  resolvedVersion?: string
  latestStable?: string
  latest?: string
  locked?: string
  registry?: string
  status: string
  error?: string
  line: number
  source: {
    type: string
    [key: string]: unknown
  }
}
```

## Examples

See the [examples](./examples) directory for complete working examples:

- **[single-crate.ts](./examples/single-crate.ts)** - Analyze a single Cargo.toml
- **[batch-analysis.ts](./examples/batch-analysis.ts)** - Batch analyze workspace
- **[custom-registry.ts](./examples/custom-registry.ts)** - Use private registries
- **[security-audit.ts](./examples/security-audit.ts)** - Security audit script

## CLI JSON Output

The CLI also supports JSON output for integration with other tools:

```bash
fancy-crates-cli ./Cargo.toml --json > output.json
```

The JSON output includes:
- All dependency information
- Version status (latest, patch-behind, minor-behind, major-behind, error)
- Summary statistics

## Use Cases

### CI/CD Integration

```typescript
import { validateBatch } from 'fancy-crates/api'

const result = await validateBatch({ rootDir: '.' })

// Fail CI if there are major version lags
if (result.summary.majorBehind > 0) {
  console.error(`${result.summary.majorBehind} dependencies need major updates`)
  process.exit(1)
}
```

### Dependency Report Generation

```typescript
import { validateBatch, exportBatchToJson } from 'fancy-crates/api'
import { writeFile } from 'fs/promises'

const result = await validateBatch({ rootDir: './workspace' })
const json = exportBatchToJson(result)
await writeFile('dependency-report.json', json)
```

### Custom Filtering

```typescript
import { validateCrate } from 'fancy-crates/api'

const result = await validateCrate('./Cargo.toml')

// Find all dependencies from a specific registry
const privateDeps = result.dependencies.filter(
  d => d.dependency.registry === 'my-private-registry'
)

// Find severely outdated dependencies
const outdated = result.dependencies.filter(
  d => d.status === 'major-behind'
)
```

## Configuration

### Custom Registries

```typescript
const registries = [
  {
    name: 'my-registry',
    index: 'https://registry.example.com/index/',
    cache: 'my-registry-cache-dir', // optional
    token: process.env.REGISTRY_TOKEN, // optional
  }
]

const result = await validateCrate('./Cargo.toml', { registries })
```

### Logger

```typescript
const logger = {
  debug: (msg) => console.log(`[DEBUG] ${msg}`),
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
}

const result = await validateCrate('./Cargo.toml', { logger })
```

## License

MIT
