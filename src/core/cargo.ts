import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser'

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

/**
 * Extract source replacement config for ValidatorConfig from CargoConfig.
 * Returns the index and token fields needed by ValidatorConfig.sourceReplacement.
 */
export const getSourceReplacement = (cargoConfig: CargoConfig): { index: string; token?: string } | undefined => {
  if (!cargoConfig.sourceReplacement) {
    return undefined
  }
  return {
    index: cargoConfig.sourceReplacement.index,
    token: cargoConfig.sourceReplacement.token,
  }
}

/** Subset of Cargo's config format that we care about */
interface RawCargoConfig {
  registries?: Record<string, { index?: unknown; token?: unknown }>
  source?: Record<string, { 'replace-with'?: unknown; registry?: unknown }>
}

type TomlObject = Record<string, unknown>

const isObject = (v: unknown): v is TomlObject => typeof v === 'object' && v !== null && !Array.isArray(v)

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Deep-merge `override` into `base`; values from `override` win */
const deepMerge = (base: TomlObject, override: TomlObject): TomlObject => {
  const result: TomlObject = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key]
    result[key] = isObject(existing) && isObject(value) ? deepMerge(existing, value) : value
  }
  return result
}

/** Resolve CARGO_HOME the same way Cargo does */
const getCargoHome = (): string => process.env.CARGO_HOME ?? path.join(os.homedir(), '.cargo')

/** Read and parse a TOML file, returning undefined if it does not exist or is invalid */
const readTomlFile = async (filePath: string): Promise<TomlObject | undefined> => {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return undefined
  }
  try {
    const value = getStaticTOMLValue(parseTOML(content))
    return isObject(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Read the first existing file among the candidates.
 * Cargo prefers the extension-less legacy name when both exist.
 */
const readFirstToml = async (dir: string, names: string[]): Promise<TomlObject | undefined> => {
  for (const name of names) {
    const value = await readTomlFile(path.join(dir, name))
    if (value) {
      return value
    }
  }
  return undefined
}

/**
 * Collect config directories in Cargo's lookup order, from highest to lowest priority:
 * `cwd/.cargo`, `cwd/../.cargo`, ..., `/.cargo`, then `$CARGO_HOME`.
 * https://doc.rust-lang.org/cargo/reference/config.html#hierarchical-structure
 */
const getConfigDirs = (cwd: string, cargoHome: string): string[] => {
  const dirs: string[] = []
  let dir = path.resolve(cwd)
  for (;;) {
    dirs.push(path.join(dir, '.cargo'))
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  const home = path.resolve(cargoHome)
  if (!dirs.includes(home)) {
    dirs.push(home)
  }
  return dirs
}

/** Converts a registry name to the env var infix Cargo uses (e.g. `my-reg` -> `MY_REG`) */
const envName = (name: string): string => name.toUpperCase().replace(/-/g, '_')

const stripSparsePrefix = (url: string): string => (url.startsWith('sparse+') ? url.slice(7) : url)

/**
 * Load cargo config including registries and source replacements.
 * Reads `.cargo/config.toml` files hierarchically (like Cargo does), `$CARGO_HOME/credentials.toml`
 * and `CARGO_REGISTRIES_<NAME>_{INDEX,TOKEN}` environment variables.
 *
 * @param cwd Directory to start the config lookup from (usually the directory of Cargo.toml)
 */
export const loadCargoConfig = async (cwd: string = process.cwd()): Promise<CargoConfig> => {
  const cargoHome = getCargoHome()
  const dirs = getConfigDirs(cwd, cargoHome)

  // Lowest priority first so that closer configs override farther ones
  let merged: TomlObject = {}
  for (const dir of [...dirs].reverse()) {
    const value = await readFirstToml(dir, ['config', 'config.toml'])
    if (value) {
      merged = deepMerge(merged, value)
    }
  }

  const credentials = (await readFirstToml(cargoHome, ['credentials', 'credentials.toml'])) as
    | RawCargoConfig
    | undefined

  return parseCargoConfig(merged as RawCargoConfig, credentials, process.env)
}

/**
 * Build CargoConfig from an already merged raw Cargo config.
 * Token priority: env var > credentials file > config file.
 */
export const parseCargoConfig = (
  config: RawCargoConfig,
  credentials: RawCargoConfig | undefined,
  env: NodeJS.ProcessEnv,
): CargoConfig => {
  const getToken = (name: string): string | undefined =>
    env[`CARGO_REGISTRIES_${envName(name)}_TOKEN`] ??
    asString(credentials?.registries?.[name]?.token) ??
    asString(config.registries?.[name]?.token)

  const getIndex = (name: string): string | undefined =>
    env[`CARGO_REGISTRIES_${envName(name)}_INDEX`] ?? asString(config.registries?.[name]?.index)

  const registries: CargoRegistry[] = []
  for (const name of Object.keys(config.registries ?? {})) {
    const index = getIndex(name)
    if (index) {
      registries.push({ name, index: stripSparsePrefix(index), token: getToken(name) })
    }
  }

  let sourceReplacement: CargoSourceReplacement | undefined
  const replaceWith = asString(config.source?.['crates-io']?.['replace-with'])
  if (replaceWith) {
    // `replace-with` may name either a [source.<name>] or a [registries.<name>] entry
    const index = asString(config.source?.[replaceWith]?.registry) ?? getIndex(replaceWith)
    if (index) {
      sourceReplacement = {
        source: 'crates-io',
        replaceWith,
        index: stripSparsePrefix(index),
        token: getToken(replaceWith),
      }
    }
  }

  return { registries, sourceReplacement }
}
