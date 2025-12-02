import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import semver from 'semver'

import { parseTOML } from 'toml-eslint-parser'
import type { TOMLBare, TOMLContentNode, TOMLKeyValue, TOMLQuoted, TOMLStringValue } from 'toml-eslint-parser/lib/ast'

/**
 * A locked package entry from Cargo.lock
 */
export interface LockedPackage {
  name: string
  version: semver.SemVer
  /** Source registry URL if not from local path */
  source?: string
}

/**
 * Parsed Cargo.lock file contents
 */
export interface CargoLockfile {
  /** Lock file format version (1, 2, 3, or 4) */
  version: number
  /** Map of package name to locked versions (can have multiple versions of same package) */
  packages: Map<string, LockedPackage[]>
}

const execFileAsync = promisify(execFile)

/**
 * Find the Cargo.lock file for a given Cargo.toml file.
 * Uses `cargo metadata` to find the workspace root, then looks for Cargo.lock there.
 */
export async function findCargoLockPath(cargoTomlPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('cargo', ['metadata', '--format-version', '1', '--no-deps'], {
      cwd: path.dirname(cargoTomlPath),
    })
    const metadata = JSON.parse(stdout) as { workspace_root?: string }
    const workspaceRoot = metadata.workspace_root
    if (!workspaceRoot) {
      return undefined
    }
    const lockPath = path.join(workspaceRoot, 'Cargo.lock')
    if (existsSync(lockPath)) {
      return lockPath
    }
  } catch {
    // cargo metadata failed (non-zero exit code, cargo not found, etc.)
  }
  return undefined
}

/**
 * Parse a Cargo.lock file and extract package information.
 * The format is flexible to handle different lock file versions (v1, v2, v3, v4).
 */
export function parseCargoLockfile(content: string): CargoLockfile {
  const packages = new Map<string, LockedPackage[]>()
  let version = 1 // Default to v1 if not specified

  try {
    const toml = parseTOML(content)

    // Extract top-level values and tables
    for (const entry of toml.body[0].body) {
      if (entry.type === 'TOMLKeyValue') {
        const key = entry.key.keys.map(getKeyString).join('.')

        if (key === 'version') {
          const val = entry.value
          if (val.type === 'TOMLValue' && val.kind === 'integer') {
            version = val.value as number
          }
        }
      }

      // Handle [[package]] array of tables
      if (entry.type === 'TOMLTable' && entry.kind === 'array') {
        const tableName = entry.key.keys.map(getKeyString).join('.')
        if (tableName === 'package') {
          const pkg = parsePackageEntry(entry.body)
          if (pkg) {
            const existing = packages.get(pkg.name) ?? []
            existing.push(pkg)
            packages.set(pkg.name, existing)
          }
        }
      }
    }
  } catch {
    // If parsing fails, return empty lockfile
    return { version: 1, packages: new Map() }
  }

  return { version, packages }
}

/** Returns the name of the TOML bare or quoted key */
function getKeyString(key: TOMLBare | TOMLQuoted): string {
  if (key.type === 'TOMLBare') {
    return key.name
  } else {
    return key.value
  }
}

function isTOMLStringValue(v: TOMLContentNode): v is TOMLStringValue {
  return v.type === 'TOMLValue' && v.kind === 'string'
}

/**
 * Parse a single [[package]] entry from the lock file
 */
function parsePackageEntry(body: TOMLKeyValue[]): LockedPackage | undefined {
  let name: string | undefined
  let versionStr: string | undefined
  let source: string | undefined

  for (const entry of body) {
    const key = entry.key.keys.map(getKeyString).join('.')
    const val = entry.value

    if (key === 'name' && isTOMLStringValue(val)) {
      name = val.value
    } else if (key === 'version' && isTOMLStringValue(val)) {
      versionStr = val.value
    } else if (key === 'source' && isTOMLStringValue(val)) {
      source = val.value
    }
  }

  if (!name || !versionStr) {
    return undefined
  }

  const version = semver.parse(versionStr)
  if (!version) {
    return undefined
  }

  return { name, version, source }
}

/**
 * Read and parse a Cargo.lock file
 */
export function readCargoLockfile(lockPath: string): CargoLockfile | undefined {
  try {
    const content = readFileSync(lockPath, 'utf-8')
    return parseCargoLockfile(content)
  } catch {
    return undefined
  }
}

/**
 * Get the locked version for a dependency from the lockfile.
 * If multiple versions exist (possible in workspaces), returns the one that
 * best matches the specified version range.
 */
export function getLockedVersion(
  lockfile: CargoLockfile,
  crateName: string,
  versionRange?: semver.Range,
): semver.SemVer | undefined {
  const versions = lockfile.packages.get(crateName)
  if (!versions || versions.length === 0) {
    return undefined
  }

  // If only one version, return it
  if (versions.length === 1) {
    return versions[0]?.version
  }

  // If we have a version range, find the best matching version
  if (versionRange) {
    const matching = versions.filter((v) => versionRange.test(v.version))
    if (matching.length > 0) {
      // Return highest matching version
      const sorted = matching.sort((a, b) => semver.compare(b.version, a.version))
      return sorted[0]?.version
    }
  }

  // Return highest version if no range specified or no match
  const sorted = versions.sort((a, b) => semver.compare(b.version, a.version))
  return sorted[0]?.version
}
