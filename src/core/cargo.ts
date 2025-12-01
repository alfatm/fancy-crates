import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

/**
 * Registry configuration from cargo config
 */
export interface CargoRegistry {
  name: string
  index: string
  cache?: string
  docs?: string
  token?: string
}

/**
 * Source replacement configuration (e.g., crates.io mirror)
 */
export interface CargoSourceReplacement {
  /** The source being replaced (e.g., "crates-io") */
  source: string
  /** The replacement source name */
  replaceWith: string
  /** The replacement registry index URL */
  index: string
  /** Authentication token for the replacement registry */
  token?: string
}

/**
 * Combined cargo config result
 */
export interface CargoConfig {
  registries: CargoRegistry[]
  sourceReplacement?: CargoSourceReplacement
}

/**
 * Raw cargo config registries format
 */
interface CargoConfigRegistries {
  registries?: Record<
    string,
    {
      index?: string
      token?: string
      'credential-provider'?: string[]
    }
  >
}

/**
 * Raw cargo config source format
 */
interface CargoConfigSource {
  source?: Record<
    string,
    {
      'replace-with'?: string
      registry?: string
    }
  >
}

/**
 * Load cargo config including registries and source replacements.
 * Executes: cargo config get registries --format json
 * Executes: cargo config get source --format json
 *
 * @param cwd Working directory to run cargo config from (affects which .cargo/config.toml is used)
 * @returns CargoConfig or Error
 */
export async function loadCargoConfig(cwd?: string): Promise<CargoConfig | Error> {
  try {
    // Load registries and source config in parallel
    const [registriesResult, sourceResult] = await Promise.all([loadRegistriesConfig(cwd), loadSourceConfig(cwd)])

    const registries = registriesResult instanceof Error ? [] : registriesResult
    const sourceReplacement = sourceResult instanceof Error ? undefined : sourceResult

    return {
      registries,
      sourceReplacement,
    }
  } catch (err) {
    const error = err as Error
    return new Error(`Failed to load cargo config: ${error.message}`)
  }
}

async function loadRegistriesConfig(cwd?: string): Promise<CargoRegistry[] | Error> {
  try {
    const { stdout } = await execAsync('cargo config get registries --format json', {
      cwd,
      timeout: 10000,
    })

    // cargo outputs notes to stderr, we only need stdout
    const jsonLine = stdout.trim().split('\n')[0]
    if (!jsonLine) {
      return []
    }

    const config: CargoConfigRegistries = JSON.parse(jsonLine)
    if (!config.registries) {
      return []
    }

    const registries: CargoRegistry[] = []
    for (const [name, registry] of Object.entries(config.registries)) {
      if (registry.index) {
        // Remove sparse+ prefix if present
        let index = registry.index
        if (index.startsWith('sparse+')) {
          index = index.slice(7)
        }

        // Get token from config or environment variable
        // Environment variable format: CARGO_REGISTRIES_<NAME>_TOKEN (name in uppercase with - replaced by _)
        const envVarName = `CARGO_REGISTRIES_${name.toUpperCase().replace(/-/g, '_')}_TOKEN`
        const token = registry.token ?? process.env[envVarName]

        registries.push({
          name,
          index,
          token,
        })
      }
    }

    return registries
  } catch (err) {
    const error = err as Error & { code?: string; stderr?: string }
    return new Error(`Failed to load cargo registries: ${error.message}`)
  }
}

async function loadSourceConfig(cwd?: string): Promise<CargoSourceReplacement | undefined | Error> {
  try {
    const { stdout } = await execAsync('cargo config get source --format json', {
      cwd,
      timeout: 10000,
    })

    const jsonLine = stdout.trim().split('\n')[0]
    if (!jsonLine) {
      return undefined
    }

    const config: CargoConfigSource = JSON.parse(jsonLine)
    if (!config.source) {
      return undefined
    }

    // Look for crates-io replacement
    const cratesIo = config.source['crates-io']
    if (!cratesIo?.['replace-with']) {
      return undefined
    }

    const replaceWith = cratesIo['replace-with']
    const replacement = config.source[replaceWith]
    if (!replacement?.registry) {
      return undefined
    }

    // Remove sparse+ prefix if present
    let index = replacement.registry
    if (index.startsWith('sparse+')) {
      index = index.slice(7)
    }

    // Get token from environment variable
    const envVarName = `CARGO_REGISTRIES_${replaceWith.toUpperCase().replace(/-/g, '_')}_TOKEN`
    const token = process.env[envVarName]

    return {
      source: 'crates-io',
      replaceWith,
      index,
      token,
    }
  } catch {
    // Source config is optional, don't treat as error
    return undefined
  }
}
