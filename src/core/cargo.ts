import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

const CARGO_TIMEOUT_MS = 10000

export interface CargoRegistry {
  name: string
  index: string
  cache?: string
  docs?: string
  token?: string
}

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

export interface CargoConfig {
  registries: CargoRegistry[]
  sourceReplacement?: CargoSourceReplacement
}

interface CargoConfigRegistries {
  registries?: Record<string, { index?: string; token?: string }>
}

interface CargoConfigSource {
  source?: Record<string, { 'replace-with'?: string; registry?: string }>
}

/**
 * Load cargo config including registries and source replacements.
 * Executes: cargo config get registries --format json
 * Executes: cargo config get source --format json
 *
 * @param cwd Working directory to run cargo config from (affects which .cargo/config.toml is used)
 * @throws Error if cargo config cannot be loaded
 */
export const loadCargoConfig = async (cwd?: string): Promise<CargoConfig> => {
  const [registries, sourceReplacement] = await Promise.all([loadRegistriesConfig(cwd), loadSourceConfig(cwd)])
  return { registries, sourceReplacement }
}

const loadRegistriesConfig = async (cwd?: string): Promise<CargoRegistry[]> => {
  try {
    const { stdout } = await execAsync('cargo config get registries --format json', {
      cwd,
      timeout: CARGO_TIMEOUT_MS,
    })

    const jsonLine = stdout.trim().split('\n')[0]
    if (!jsonLine) {
      return []
    }

    const config: CargoConfigRegistries = JSON.parse(jsonLine)
    if (!config.registries) {
      return []
    }

    return Object.entries(config.registries)
      .filter((entry): entry is [string, { index: string; token?: string }] => Boolean(entry[1].index))
      .map(([name, reg]) => {
        const index = stripSparsePrefix(reg.index)
        const envToken = `CARGO_REGISTRIES_${name.toUpperCase().replace(/-/g, '_')}_TOKEN`
        return { name, index, token: reg.token ?? process.env[envToken] }
      })
  } catch {
    return []
  }
}

const loadSourceConfig = async (cwd?: string): Promise<CargoSourceReplacement | undefined> => {
  try {
    const { stdout } = await execAsync('cargo config get source --format json', {
      cwd,
      timeout: CARGO_TIMEOUT_MS,
    })

    const jsonLine = stdout.trim().split('\n')[0]
    if (!jsonLine) {
      return undefined
    }

    const config: CargoConfigSource = JSON.parse(jsonLine)
    const cratesIo = config.source?.['crates-io']
    const replaceWith = cratesIo?.['replace-with']
    if (!replaceWith) {
      return undefined
    }

    const replacement = config.source?.[replaceWith]
    if (!replacement?.registry) {
      return undefined
    }

    const index = stripSparsePrefix(replacement.registry)
    const envToken = `CARGO_REGISTRIES_${replaceWith.toUpperCase().replace(/-/g, '_')}_TOKEN`

    return {
      source: 'crates-io',
      replaceWith,
      index,
      token: process.env[envToken],
    }
  } catch {
    return undefined
  }
}

const stripSparsePrefix = (url: string): string => (url.startsWith('sparse+') ? url.slice(7) : url)
