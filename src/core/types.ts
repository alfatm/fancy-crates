import type semver from 'semver'

/**
 * A Cargo dependency specification
 */
export interface Dependency {
  /** The crate name of the dependency on the registry. */
  name: string
  /** The compatible version range of the dependency. */
  version: semver.Range
  /** The original version string as specified in Cargo.toml */
  versionRaw: string
  /** The name of the registry, if explicitly given. */
  registry?: string
  /** The line number of the dependency's version requirement. 0-based. */
  line: number
}

/**
 * Registry configuration
 */
export interface Registry {
  index: URL
  cache?: string
  docs?: URL
  /** Authentication token for private registries */
  token?: string
}

/**
 * Dependency status indicating how far behind the latest version
 * - latest: Using the latest version
 * - patch-behind: New patch available (1.2.3 → 1.2.4)
 * - minor-behind: New minor available (1.2.3 → 1.3.0)
 * - major-behind: New major available (1.2.3 → 2.0.0)
 * - error: Could not determine version
 */
export type DependencyStatus = 'latest' | 'patch-behind' | 'minor-behind' | 'major-behind' | 'error'

/**
 * Result of validating a single dependency
 */
export interface DependencyValidationResult {
  dependency: Dependency
  resolved: semver.SemVer | null
  latestStable: semver.SemVer | undefined
  latest: semver.SemVer | undefined
  /** The version currently locked in Cargo.lock */
  locked: semver.SemVer | undefined
  error?: Error
  status: DependencyStatus
}

/**
 * Result of validating an entire Cargo.toml file
 */
export interface ValidationResult {
  filePath: string
  dependencies: DependencyValidationResult[]
  parseError?: Error
}

/**
 * Configuration for the validator
 */
export interface ValidatorConfig {
  /** crates.io index URL */
  cratesIoIndex: URL
  /** crates.io cache directory name */
  cratesIoCache: string
  /** Use Cargo's local cache */
  useCargoCache: boolean
  /** Alternate registries */
  registries: {
    name: string
    index: string
    cache?: string
    docs?: string
    token?: string
  }[]
  /** Source replacement for crates.io (mirror) */
  sourceReplacement?: {
    index: string
    token?: string
  }
  /** Options for fetch operations */
  fetchOptions?: FetchOptions
}

/**
 * Logger interface for fetch operations
 */
export interface Logger {
  debug(msg: string): void
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

/**
 * Options for fetch operations
 */
export interface FetchOptions {
  logger?: Logger
  userAgent?: string
}
