import type semver from 'semver'

/**
 * Source type for a dependency
 */
export type DependencySource =
  | { type: 'registry'; registry?: string }
  | { type: 'path'; path: string }
  | { type: 'git'; git: string; branch?: string; tag?: string; rev?: string }

/**
 * A Cargo dependency specification
 */
export interface Dependency {
  /** The crate name of the dependency on the registry. */
  name: string
  /** The compatible version range of the dependency (undefined for path/git without version). */
  version?: semver.Range
  /** The original version string as specified in Cargo.toml */
  versionRaw?: string
  /** The name of the registry, if explicitly given. */
  registry?: string
  /** The line number of the dependency's version requirement. 0-based. */
  line: number
  /** The source of the dependency (registry, path, or git) */
  source: DependencySource
  /** Whether the dependency is disabled via `# crates: disable-check` comment */
  disabled?: boolean
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
  /** Git source resolution options */
  gitOptions?: GitSourceOptions
}

/**
 * Custom git host configuration for private repositories
 */
export interface CustomGitHost {
  /**
   * Host pattern to match (e.g., "github.mycompany.com" or "gitlab.internal.org")
   */
  host: string
  /**
   * Type of git hosting platform: "github" or "gitlab"
   * Used to determine the raw file URL format
   */
  type: 'github' | 'gitlab'
  /**
   * Authentication token for accessing private repositories
   * For GitHub: personal access token or fine-grained token
   * For GitLab: personal access token or project token
   */
  token?: string
}

/**
 * Options for git source resolution
 */
export interface GitSourceOptions {
  /**
   * Enable git archive method (requires git, sh, tar).
   * Only works with servers that support `git archive --remote`.
   */
  enableGitArchive?: boolean
  /**
   * (Experimental) Enable shallow clone method for git dependencies.
   * This creates temporary directories and runs git commands.
   * Disabled by default.
   */
  enableShallowClone?: boolean
  /**
   * Custom git hosts configuration for private/enterprise repositories.
   * Allows specifying authentication tokens and host types.
   */
  customHosts?: CustomGitHost[]
}

/**
 * Result of checking CLI tool availability
 */
export interface CliToolsAvailability {
  /** Whether git command is available */
  git: boolean
  /** Whether sh command is available */
  sh: boolean
  /** Whether tar command is available */
  tar: boolean
}
