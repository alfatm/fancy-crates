import semver from 'semver'
import type {
  TOMLBare,
  TOMLContentNode,
  TOMLKeyValue,
  TOMLQuoted,
  TOMLStringValue,
  TOMLTable,
} from 'toml-eslint-parser/lib/ast'

import type { Dependency, DependencySource } from './types.js'

/** The disable-check comment pattern for individual dependencies */
const DISABLE_CHECK_INLINE = /# *crates: *disable-check/i

/** The disable-check comment pattern for the entire file (in the header) */
const DISABLE_CHECK_FILE = /^#! *crates: *disable-check/im

/**
 * Check if the file has a file-level disable-check comment in the header.
 * The comment `#! crates: disable-check` at the beginning of the file disables all checks.
 */
export function hasFileDisableCheck(content: string): boolean {
  return DISABLE_CHECK_FILE.test(content)
}

/**
 * Check if a specific line has an inline disable-check comment.
 * The comment `# crates: disable-check` on a dependency line disables the check for that dependency.
 */
export function hasLineDisableCheck(content: string, line: number): boolean {
  const lines = content.split('\n')
  const lineContent = lines[line]
  if (lineContent === undefined) {
    return false
  }
  return DISABLE_CHECK_INLINE.test(lineContent)
}

/**
 * Parses `Cargo.toml` tables and returns all dependencies that have valid semver requirements.
 * @param body - The parsed TOML tables
 * @param content - The original file content (used to detect disable-check comments)
 */
export function parseCargoDependencies(body: TOMLTable[], content?: string): Dependency[] {
  const fileDisabled = content ? hasFileDisableCheck(content) : false
  return body
    .flatMap((node) => {
      const keys = node.key.keys.map(getKeyString)
      const [key0, key1, key2, key3] = keys
      if (keys.length === 1 && key0 !== undefined && isDependencyKey(key0)) {
        // [dependencies]
        // tokio = "1"
        // clap = { version = "4" }
        return parseMultipleDependencies(node.body, content, fileDisabled)
      } else if (keys.length === 2 && key0 !== undefined && key1 !== undefined) {
        if (isDependencyKey(key0)) {
          // [dependencies.tokio]
          return parseSingleDependency(key1, node.body, content, fileDisabled)
        } else if (key0 === 'workspace' && isDependencyKey(key1)) {
          // [workspace.dependencies]
          // tokio = "1"
          // clap = { version = "4" }
          return parseMultipleDependencies(node.body, content, fileDisabled)
        }
        return []
      } else if (keys.length === 3 && key0 !== undefined && key1 !== undefined && key2 !== undefined) {
        if (key0 === 'workspace' && isDependencyKey(key1)) {
          // [workspace.dependencies.tokio]
          return parseSingleDependency(key2, node.body, content, fileDisabled)
        } else if (key0 === 'target' && isDependencyKey(key2)) {
          // [target.whatever.dependencies]
          // tokio = "1"
          // clap = { version = "4" }
          return parseMultipleDependencies(node.body, content, fileDisabled)
        }
        return []
      } else if (
        keys.length === 4 &&
        key0 === 'target' &&
        key2 !== undefined &&
        key3 !== undefined &&
        isDependencyKey(key2)
      ) {
        // [target.whatever.dependencies.tokio]
        return parseSingleDependency(key3, node.body, content, fileDisabled)
      }
      return []
    })
    .filter((d): d is Dependency => d !== undefined)
}

/** Parses the body of a Cargo dependency table that represents a single dependency.
 * Supports registry dependencies with version, path dependencies, and git dependencies.
 * ## Example Inline Table
 * ```toml
 * clap = { version = "4" }
 * local_crate = { path = "../local_crate" }
 * git_crate = { git = "https://github.com/user/repo", branch = "main" }
 * ```
 * ## Example Table
 * ```toml
 * [dependencies.tokio]
 * version = "1"
 * ```
 */
function parseSingleDependency(
  crateName: string,
  body: TOMLKeyValue[],
  content?: string,
  fileDisabled?: boolean,
): Dependency | undefined {
  let line: number | undefined
  let version: semver.Range | undefined
  let versionRaw: string | undefined
  let registry: string | undefined
  let packageName: string | undefined
  let pathValue: string | undefined
  let gitValue: string | undefined
  let gitBranch: string | undefined
  let gitTag: string | undefined
  let gitRev: string | undefined

  for (const node of body) {
    const firstKey = node.key.keys[0]
    if (node.key.keys.length === 1 && firstKey !== undefined) {
      const key = getKeyString(firstKey)
      const value = node.value
      if (key === 'version' && isTOMLStringValue(value)) {
        const v = parseVersionRange(value.value)
        if (v !== undefined) {
          version = v
          versionRaw = value.value
          // TOML parser lines are 1-based, but VSCode lines are 0-based
          line = node.loc.end.line - 1
        }
      } else if (key === 'package' && isTOMLStringValue(value)) {
        packageName = value.value
      } else if (key === 'registry' && isTOMLStringValue(value)) {
        registry = value.value
      } else if (key === 'path' && isTOMLStringValue(value)) {
        pathValue = value.value
        if (line === undefined) {
          line = node.loc.end.line - 1
        }
      } else if (key === 'git' && isTOMLStringValue(value)) {
        gitValue = value.value
        if (line === undefined) {
          line = node.loc.end.line - 1
        }
      } else if (key === 'branch' && isTOMLStringValue(value)) {
        gitBranch = value.value
      } else if (key === 'tag' && isTOMLStringValue(value)) {
        gitTag = value.value
      } else if (key === 'rev' && isTOMLStringValue(value)) {
        gitRev = value.value
      }
    }
  }

  // Determine the source type
  const source: DependencySource = pathValue
    ? { type: 'path', path: pathValue }
    : gitValue
      ? { type: 'git', git: gitValue, branch: gitBranch, tag: gitTag, rev: gitRev }
      : { type: 'registry', registry }

  // Check if this dependency is disabled via comment
  const disabled = fileDisabled || (content && line !== undefined ? hasLineDisableCheck(content, line) : false)

  // For registry dependencies, version is required
  if (source.type === 'registry') {
    if (version !== undefined && versionRaw !== undefined && line !== undefined) {
      return {
        name: packageName ?? crateName,
        version,
        versionRaw,
        line,
        registry,
        source,
        disabled: disabled || undefined,
      }
    }
    return undefined
  }

  // For path/git dependencies, version is optional (will be resolved from source)
  if (line !== undefined) {
    return {
      name: packageName ?? crateName,
      version,
      versionRaw,
      line,
      registry,
      source,
      disabled: disabled || undefined,
    }
  }

  return undefined
}

/** Parses the body of a Cargo dependency table that contains multiple dependencies.
 * ## An Example Table
 * ```toml
 * [dependencies]
 * clap = { version = "4" }
 * "tokio" = "1"
 * ```
 */
function parseMultipleDependencies(body: TOMLKeyValue[], content?: string, fileDisabled?: boolean): Dependency[] {
  return body
    .map((node): Dependency | undefined => {
      const firstKey = node.key.keys[0]
      if (firstKey === undefined) {
        return undefined
      }
      const key = getKeyString(firstKey)
      const value = node.value
      if (isTOMLStringValue(value)) {
        // crate_name = "version"
        const version = parseVersionRange(value.value)
        if (version !== undefined) {
          const line = node.loc.end.line - 1
          const disabled = fileDisabled || (content ? hasLineDisableCheck(content, line) : false)
          return {
            name: key,
            version,
            versionRaw: value.value,
            // TOML parser lines are 1-based, but VSCode lines are 0-based
            line,
            registry: undefined,
            source: { type: 'registry', registry: undefined },
            disabled: disabled || undefined,
          }
        }
        return undefined
      } else if (value.type === 'TOMLInlineTable') {
        // crate_name = { version = "version" ... } or { path = "..." } or { git = "..." }
        return parseSingleDependency(key, value.body, content, fileDisabled)
      }
      return undefined
    })
    .filter((d): d is Dependency => d !== undefined)
}

/** Parses Cargo's semver requirement */
export function parseVersionRange(s: string): semver.Range | undefined {
  try {
    // Cargo uses comma to separated multiple "and" requirements, but semver uses whitespace
    return new semver.Range(
      s
        .split(',')
        .map((s) => s.trim())
        .map(plainVersionCompatibilityFix)
        .join(' '),
    )
  } catch {
    return
  }
}

/** When plain version requirements are given, Cargo resolves them as if they are caret requirements.
 * However, Node semver resolves them as if they are equality comparisons. This function tries to fix
 * the incompatibility by adding a leading "^" to a version requirement string if it begins with a digit.
 *
 * | version |      Cargo       |      semver      |
 * | ------- | ---------------- | ---------------- |
 * | 1.2.3   | >=1.2.3 <2.0.0-0 | =1.2.3           |
 * | 2.0     | >=2.0.0 <3.0.0-0 | >=2.0.0 <2.1.0-0 |
 * | 3       | >=3.0.0 <4.0.0-0 | >=3.0.0 <4.0.0-0 |
 * | 0       | >=0.0.0 <1.0.0-0 | >=0.0.0 <1.0.0-0 |
 * | 0.2     | >=0.2.0 <0.3.0-0 | >=0.2.0 <0.3.0-0 |
 * | 0.3.4   | >=0.3.4 <0.4.0-0 | =0.3.4           |
 */
function plainVersionCompatibilityFix(s: string): string {
  if (Number.isNaN(Number.parseInt(s.charAt(0), 10))) {
    return s
  } else {
    return `^${s}`
  }
}

function isTOMLStringValue(v: TOMLContentNode): v is TOMLStringValue {
  return v.type === 'TOMLValue' && v.kind === 'string'
}

/** Returns the name of the TOML bare or quoted key */
function getKeyString(key: TOMLBare | TOMLQuoted): string {
  if (key.type === 'TOMLBare') {
    return key.name
  } else {
    return key.value
  }
}

/** Returns whether the TOML bare or quoted key name indicates the presence of a Cargo dependency table */
function isDependencyKey(name: string): boolean {
  return name === 'dependencies' || name === 'dev-dependencies' || name === 'build-dependencies'
}
