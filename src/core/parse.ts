import semver from 'semver'
import type {
  TOMLBare,
  TOMLContentNode,
  TOMLKeyValue,
  TOMLQuoted,
  TOMLStringValue,
  TOMLTable,
} from 'toml-eslint-parser/lib/ast'

import type { Dependency } from './types.js'

/**
 * Parses `Cargo.toml` tables and returns all dependencies that have valid semver requirements.
 */
export function parseCargoDependencies(body: TOMLTable[]): Dependency[] {
  return body
    .flatMap((node) => {
      const keys = node.key.keys.map(getKeyString)
      const [key0, key1, key2, key3] = keys
      if (keys.length === 1 && key0 !== undefined && isDependencyKey(key0)) {
        // [dependencies]
        // tokio = "1"
        // clap = { version = "4" }
        return parseMultipleDependencies(node.body)
      } else if (keys.length === 2 && key0 !== undefined && key1 !== undefined) {
        if (isDependencyKey(key0)) {
          // [dependencies.tokio]
          return parseSingleDependency(key1, node.body)
        } else if (key0 === 'workspace' && isDependencyKey(key1)) {
          // [workspace.dependencies]
          // tokio = "1"
          // clap = { version = "4" }
          return parseMultipleDependencies(node.body)
        }
        return []
      } else if (keys.length === 3 && key0 !== undefined && key1 !== undefined && key2 !== undefined) {
        if (key0 === 'workspace' && isDependencyKey(key1)) {
          // [workspace.dependencies.tokio]
          return parseSingleDependency(key2, node.body)
        } else if (key0 === 'target' && isDependencyKey(key2)) {
          // [target.whatever.dependencies]
          // tokio = "1"
          // clap = { version = "4" }
          return parseMultipleDependencies(node.body)
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
        return parseSingleDependency(key3, node.body)
      }
      return []
    })
    .filter((d): d is Dependency => d !== undefined)
}

/** Parses the body of a Cargo dependency table that represents a single dependency
 * with a valid semver requirement.
 * ## Example Inline Table
 * ```toml
 * clap = { version = "4" }
 * ```
 * ## Example Table
 * ```toml
 * [dependencies.tokio]
 * version = "1"
 * ```
 */
function parseSingleDependency(crateName: string, body: TOMLKeyValue[]): Dependency | undefined {
  let line: number | undefined
  let version: semver.Range | undefined
  let registry: string | undefined
  let packageName: string | undefined
  for (const node of body) {
    const firstKey = node.key.keys[0]
    if (node.key.keys.length === 1 && firstKey !== undefined) {
      const key = getKeyString(firstKey)
      const value = node.value
      if (key === 'version' && isTOMLStringValue(value)) {
        const v = parseVersionRange(value.value)
        if (v !== undefined) {
          version = v
          // TOML parser lines are 1-based, but VSCode lines are 0-based
          line = node.loc.end.line - 1
        }
      } else if (key === 'package' && isTOMLStringValue(value)) {
        packageName = value.value
      } else if (key === 'registry' && isTOMLStringValue(value)) {
        registry = value.value
      }
    }
  }
  if (version !== undefined && line !== undefined) {
    return {
      name: packageName ?? crateName,
      version,
      line,
      registry,
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
function parseMultipleDependencies(body: TOMLKeyValue[]): Dependency[] {
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
          return {
            name: key,
            version,
            // TOML parser lines are 1-based, but VSCode lines are 0-based
            line: node.loc.end.line - 1,
            registry: undefined,
          }
        }
        return undefined
      } else if (value.type === 'TOMLInlineTable') {
        // crate_name = { version = "version" ... }
        return parseSingleDependency(key, value.body)
      }
      return undefined
    })
    .filter((d): d is Dependency => d !== undefined)
}

/** Parses Cargo's semver requirement */
function parseVersionRange(s: string): semver.Range | undefined {
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
