import path from 'node:path'

import type semver from 'semver'

import type { DependencySource, DependencyStatus, DependencyValidationResult } from './types'

// Status symbols with colors:
// 🟢 latest - green
// 🟡 patch-behind - yellow (minor issue)
// 🟠 minor-behind - orange (warning)
// 🔴 major-behind - red (needs attention)
// 🔴 error - red
export const SYMBOL_LATEST = '✅'
export const SYMBOL_PATCH_BEHIND = '🟨'
export const SYMBOL_MINOR_BEHIND = '🟧'
export const SYMBOL_MAJOR_BEHIND = '🟥'
export const SYMBOL_ERROR = '❗'

const STATUS_SYMBOLS: Record<DependencyStatus, string> = {
  latest: SYMBOL_LATEST,
  'patch-behind': SYMBOL_PATCH_BEHIND,
  'minor-behind': SYMBOL_MINOR_BEHIND,
  'major-behind': SYMBOL_MAJOR_BEHIND,
  error: SYMBOL_ERROR,
}

/**
 * Escape text so it is rendered literally in Markdown.
 * Values coming from Cargo.toml, registries or cargo-deny must never be able to inject links.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()<>#+\-.!|~]/g, '\\$&').replace(/\r?\n/g, ' ')
}

/** Wrap text in an inline code span that cannot be broken out of by backticks in the text */
export function inlineCode(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longestRun + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text.replace(/\r?\n/g, ' ')}${pad}${fence}`
}

/**
 * Result of formatting a dependency for display
 */
export interface FormattedDependency {
  /** The dependency status */
  status: DependencyStatus
  /** The decoration text (emoji + version if outdated) */
  decoration: string
  /** The hover message in markdown format */
  hoverMarkdown: string
  /** The version to update to (if outdated), for "Update" button */
  updateVersion?: string
}

/**
 * Format a dependency validation result for display.
 * This is used by both VSCode extension and CLI.
 */
export function formatDependencyResult(result: DependencyValidationResult, docsUrl?: string): FormattedDependency {
  const { dependency, resolved, latestStable, latest, locked, status, error } = result
  const name = dependency.name
  const source = dependency.source

  if (status === 'error') {
    return {
      status,
      decoration: SYMBOL_ERROR,
      hoverMarkdown: escapeMarkdown(error?.message ?? 'unknown error'),
    }
  }

  if (resolved === null) {
    return {
      status: 'error',
      decoration: SYMBOL_ERROR,
      hoverMarkdown: `no versions of the crate ${inlineCode(name)} satisfy the given requirement`,
    }
  }

  if (latest === undefined) {
    return {
      status: 'error',
      decoration: SYMBOL_ERROR,
      hoverMarkdown: 'No versions available',
    }
  }

  const symbol = STATUS_SYMBOLS[status]
  const targetVersion = latestStable ?? latest

  let decoration: string
  let updateVersion: string | undefined

  if (status === 'latest') {
    decoration = symbol
  } else {
    decoration = `${symbol} ${targetVersion}`
    // Provide updateVersion for non-latest statuses
    updateVersion = targetVersion.format()
  }

  const hoverMarkdown = formatHoverMarkdown(resolved, latestStable, latest, locked, name, source, docsUrl)

  return { status, decoration, hoverMarkdown, updateVersion }
}

/**
 * Format the source information for display
 */
function formatSourceInfo(source: DependencySource): string {
  if (source.type === 'path') {
    return `- **Source**: path ${inlineCode(source.path)}`
  }
  if (source.type === 'git') {
    let info = `- **Source**: git ${inlineCode(source.git)}`
    if (source.branch) {
      info += ` (branch: ${inlineCode(source.branch)})`
    } else if (source.tag) {
      info += ` (tag: ${inlineCode(source.tag)})`
    } else if (source.rev) {
      info += ` (rev: ${inlineCode(source.rev.slice(0, 8))})`
    }
    return info
  }
  return ''
}

/**
 * Format the hover message markdown for a dependency
 */
function formatHoverMarkdown(
  resolved: semver.SemVer | null,
  latestStable: semver.SemVer | undefined,
  latest: semver.SemVer,
  locked: semver.SemVer | undefined,
  name: string,
  source: DependencySource,
  docsUrl?: string,
): string {
  const formatVersion = (v: semver.SemVer | null | undefined, label: string): string => {
    if (v === null) {
      return `- **${label}**: no versions satisfy the requirement`
    }
    if (v === undefined) {
      return `- **${label}**: not available`
    }
    // Only show docs links for registry dependencies
    if (docsUrl && source.type === 'registry') {
      const crate = encodeURIComponent(name)
      const url = docsUrl.endsWith('/') ? `${docsUrl}${crate}/${v}` : `${docsUrl}/${crate}/${v}`
      return `- **${label}**: [${v}](${url})`
    }
    return `- **${label}**: ${v}`
  }

  const lines: string[] = []

  // Add source info for path/git dependencies
  const sourceInfo = formatSourceInfo(source)
  if (sourceInfo) {
    lines.push(sourceInfo)
  }

  lines.push(formatVersion(resolved, 'Resolved'))

  // For path/git deps, latestStable and latest are the same (from source)
  if (source.type === 'registry') {
    lines.push(formatVersion(latestStable ?? null, 'Latest Stable'))
    lines.push(formatVersion(latest, 'Latest'))
  } else {
    lines.push(formatVersion(latest, 'Source Version'))
  }

  lines.push(formatVersion(locked, 'Locked'))

  return lines.join('\n')
}

/**
 * Format a link to docs for a specific version
 */
export function formatDocsLink(v: semver.SemVer | null | undefined, name: string, docs: URL | undefined): string {
  if (v === null) {
    return `no versions of the crate ${name} satisfy the given requirement`
  } else if (v === undefined) {
    return 'not available'
  } else if (docs === undefined) {
    return v.format()
  } else {
    return `[${v}](${new URL(path.posix.join(docs.pathname, name, v.format()), docs)})`
  }
}

/**
 * Build the new version requirement, keeping a single leading operator of the old one.
 * `^1.2` -> `^2.0.0`, `~1.2.3` -> `~2.0.0`, `=1.0.0` -> `=2.0.0`, `1.2` -> `2.0.0`.
 * Compound requirements like `>=1, <2` are replaced with the plain new version.
 */
export function buildNewRequirement(oldRequirement: string, newVersion: string): string {
  const match = /^\s*(\^|~|=)\s*[0-9][^,<>*]*$/.exec(oldRequirement)
  return match?.[1] ? `${match[1]}${newVersion}` : newVersion
}
