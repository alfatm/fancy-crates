import path from 'node:path'

import { type ConfigurationScope, type Uri, workspace } from 'vscode'

import type { CargoConfig } from '../core/cargo.js'
import { loadCargoConfig } from '../core/cargo.js'
import { CRATES_IO_CACHE, CRATES_IO_INDEX, mergeRegistries, type RegistryConfig } from '../core/config.js'
import type { ValidatorConfig } from '../core/types.js'
import log from './log.js'

/** User agent for VSCode extension requests */
export const VSCODE_USER_AGENT =
  'VSCode.SparseCrates (https://marketplace.visualstudio.com/items?itemName=citreae535.sparse-crates)'

// Cache for cargo config per file directory
const cargoConfigCache = new Map<string, CargoConfig>()

/**
 * Clear the cargo config cache.
 * Call this when configuration changes.
 */
export function clearCargoConfigCache(): void {
  cargoConfigCache.clear()
}

/**
 * Load cargo config for a given scope (file URI).
 * Results are cached per file directory.
 * Cargo looks for .cargo/config.toml starting from the file's directory and going up.
 */
export async function loadConfigForScope(scope: ConfigurationScope): Promise<void> {
  const uri = scope as Uri
  // Use the directory of the file (Cargo.toml), not the workspace root
  // This ensures cargo config is loaded from the correct context
  const cwd = path.dirname(uri.fsPath)

  if (cargoConfigCache.has(cwd)) {
    return
  }

  const result = await loadCargoConfig(cwd)
  if (result instanceof Error) {
    log.warn(`Failed to load cargo config: ${result.message}`)
    cargoConfigCache.set(cwd, { registries: [] })
  } else {
    log.info(
      `Loaded ${result.registries.length} registries from cargo config: ${result.registries.map((r) => r.name).join(', ')}`,
    )
    if (result.sourceReplacement) {
      log.info(`Source replacement: ${result.sourceReplacement.source} -> ${result.sourceReplacement.replaceWith}`)
    }
    cargoConfigCache.set(cwd, result)
  }
}

/**
 * Get cargo config for a given scope.
 * Must call loadConfigForScope first.
 */
function getCargoConfig(scope: ConfigurationScope): CargoConfig {
  const uri = scope as Uri
  const cwd = path.dirname(uri.fsPath)
  return cargoConfigCache.get(cwd) ?? { registries: [] }
}

/**
 * Build a ValidatorConfig from VSCode settings and cargo config.
 * Must call loadConfigForScope first.
 */
export function buildValidatorConfig(scope: ConfigurationScope): ValidatorConfig {
  const cargoConfig = getCargoConfig(scope)
  const vscodeConfig = workspace.getConfiguration('sparse-crates', scope)

  // Get VSCode settings registries
  const settingsRegistries: RegistryConfig[] = vscodeConfig.get('registries') ?? []

  // Merge registries: VSCode settings override cargo config
  const registries = mergeRegistries(cargoConfig.registries, settingsRegistries)

  // Build source replacement from cargo config
  const sourceReplacement = cargoConfig.sourceReplacement
    ? { index: cargoConfig.sourceReplacement.index, token: cargoConfig.sourceReplacement.token }
    : undefined

  return {
    cratesIoIndex: getCrateIoIndex(scope),
    cratesIoCache: getCrateIoCache(scope),
    useCargoCache: vscodeConfig.get('useCargoCache') ?? true,
    registries,
    sourceReplacement,
  }
}

function getCrateIoIndex(scope: ConfigurationScope): URL {
  try {
    return new URL(workspace.getConfiguration('sparse-crates', scope).get('cratesIoIndex') as string)
  } catch {
    return CRATES_IO_INDEX
  }
}

function getCrateIoCache(scope: ConfigurationScope): string {
  return workspace.getConfiguration('sparse-crates', scope).get('cratesIoCache') ?? CRATES_IO_CACHE
}
