import { readFile } from 'node:fs/promises'

import semver from 'semver'
import { ParseError, parseTOML } from 'toml-eslint-parser'
import type { TOMLProgram, TOMLTable } from 'toml-eslint-parser/lib/ast/ast.js'
import { DEFAULT_CONFIG, getRegistry } from './config.js'
import { fetchVersions } from './fetch.js'
import { parseCargoDependencies } from './parse.js'
import type { Dependency, DependencyValidationResult, ValidationResult, ValidatorConfig } from './types.js'

export function safeParseToml(text: string): TOMLProgram | ParseError {
  try {
    return parseTOML(text)
  } catch (err) {
    return err as ParseError
  }
}

function computeStatus(
  resolved: semver.SemVer | null,
  latestStable: semver.SemVer | undefined,
  latest: semver.SemVer | undefined,
): 'up-to-date' | 'outdated' | 'error' {
  if (resolved === null || latest === undefined) {
    return 'error'
  }
  if (resolved.compare(latest) === 0) {
    return 'up-to-date'
  }
  if (latestStable !== undefined && resolved.compare(latestStable) === 0) {
    return 'up-to-date'
  }
  if (latestStable !== undefined && latestStable.compare(resolved) === -1) {
    // latestStable < resolved (prerelease)
    if (resolved.compare(latest) === 0) {
      return 'up-to-date'
    }
  }
  return 'outdated'
}

async function validateDependency(dep: Dependency, config: ValidatorConfig): Promise<DependencyValidationResult> {
  const registry = getRegistry(dep.registry, config)

  if (registry instanceof Error) {
    return {
      dependency: dep,
      resolved: null,
      latestStable: undefined,
      latest: undefined,
      error: registry,
      status: 'error',
    }
  }

  const versionsResult = await fetchVersions(dep.name, registry, config.useCargoCache, config.fetchOptions)

  if (versionsResult instanceof Error) {
    return {
      dependency: dep,
      resolved: null,
      latestStable: undefined,
      latest: undefined,
      error: versionsResult,
      status: 'error',
    }
  }

  versionsResult.sort(semver.compareBuild).reverse()
  const resolved = semver.maxSatisfying(versionsResult, dep.version)
  const latestStable = versionsResult.find((v) => v.prerelease.length === 0)
  const latest = versionsResult[0]

  return {
    dependency: dep,
    resolved,
    latestStable,
    latest,
    status: computeStatus(resolved, latestStable, latest),
  }
}

export async function validateCargoToml(
  filePath: string,
  config: ValidatorConfig = DEFAULT_CONFIG,
): Promise<ValidationResult> {
  const content = await readFile(filePath, 'utf-8')
  return validateCargoTomlContent(content, filePath, config)
}

export async function validateCargoTomlContent(
  content: string,
  filePath: string,
  config: ValidatorConfig = DEFAULT_CONFIG,
): Promise<ValidationResult> {
  const toml = safeParseToml(content)

  if (toml instanceof ParseError) {
    return {
      filePath,
      dependencies: [],
      parseError: new Error(`Parse error at line ${toml.lineNumber}, column ${toml.column}: ${toml.message}`),
    }
  }

  const dependencies = parseCargoDependencies(toml.body[0].body.filter((v): v is TOMLTable => v.type === 'TOMLTable'))

  const results = await Promise.all(dependencies.map((dep) => validateDependency(dep, config)))

  return {
    filePath,
    dependencies: results,
  }
}
