import type { Registry, ValidatorConfig } from './types.js'

/** Default crates.io index URL (sparse protocol) */
export const CRATES_IO_INDEX = new URL('https://index.crates.io/')

/** Default crates.io cache directory name */
export const CRATES_IO_CACHE = 'index.crates.io-6f17d22bba15001f'

/** Default docs.rs URL */
export const DOCS_RS_URL = new URL('https://docs.rs/')

export const DEFAULT_CONFIG: ValidatorConfig = {
  cratesIoIndex: CRATES_IO_INDEX,
  cratesIoCache: CRATES_IO_CACHE,
  useCargoCache: true,
  registries: [],
}

export function safeParseUrl(s: string): URL | Error {
  try {
    return new URL(s)
  } catch (err) {
    return err as Error
  }
}

/** Registry config as stored in settings/cargo config */
export interface RegistryConfig {
  name: string
  index: string
  cache?: string
  docs?: string
  token?: string
}

/**
 * Parse a registry config into a Registry object.
 * Shared between extension and CLI.
 */
export function parseRegistryConfig(registry: RegistryConfig): Registry | Error {
  const index = safeParseUrl(registry.index)
  const cache = registry.cache
  const docs = registry.docs === undefined ? undefined : safeParseUrl(registry.docs)
  const token = registry.token
  if (index instanceof Error) {
    return new Error(`registry ${registry.name} - invalid index URL: ${registry.index}`)
  } else if (docs instanceof Error) {
    return new Error(`registry ${registry.name} - invalid docs URL: ${registry.docs}`)
  } else {
    return {
      index,
      cache,
      docs,
      token,
    }
  }
}

/**
 * Merge registry arrays, where later entries override earlier ones with the same name.
 * Used by both CLI (cargo config + CLI args) and extension (cargo config + VSCode settings).
 */
export function mergeRegistries(...registrySets: RegistryConfig[][]): RegistryConfig[] {
  const merged: RegistryConfig[] = []
  for (const registries of registrySets) {
    for (const reg of registries) {
      const existingIndex = merged.findIndex((r) => r.name === reg.name)
      if (existingIndex >= 0) {
        merged[existingIndex] = reg
      } else {
        merged.push(reg)
      }
    }
  }
  return merged
}

export function getRegistry(name: string | undefined, config: ValidatorConfig): Registry | Error {
  if (name !== undefined) {
    const registry = config.registries.find((r) => r.name === name)
    if (registry !== undefined) {
      return parseRegistryConfig(registry)
    } else {
      return new Error(`unknown registry: ${name}`)
    }
  }

  // Default registry (crates.io) - check for source replacement
  if (config.sourceReplacement) {
    const index = safeParseUrl(config.sourceReplacement.index)
    if (index instanceof Error) {
      return new Error(`source replacement - invalid index URL: ${config.sourceReplacement.index}`)
    }
    return {
      index,
      token: config.sourceReplacement.token,
      docs: DOCS_RS_URL,
    }
  }

  return {
    index: config.cratesIoIndex,
    cache: config.cratesIoCache,
    docs: DOCS_RS_URL,
  }
}
