import { exec } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import type { Logger } from './types'

const execAsync = promisify(exec)

/**
 * Advisory information from cargo-deny
 */
export interface Advisory {
  /** Unique advisory ID (e.g., RUSTSEC-2023-0022) */
  id: string
  /** Human-readable title */
  title: string
  /** Detailed description */
  description: string
  /** URL for more information */
  url: string | null
  /** Type of advisory: vulnerability, unmaintained, unsound, notice, yanked */
  kind: AdvisoryKind
  /** Severity level: error or warning */
  severity: 'error' | 'warning'
  /** Solution/recommendation (if available) */
  solution: string | null
  /** CVE aliases */
  aliases: string[]
}

/**
 * Types of advisories from cargo-deny
 */
export type AdvisoryKind = 'vulnerability' | 'unmaintained' | 'unsound' | 'notice' | 'yanked'

/**
 * Map of package names to their advisories
 */
export type AdvisoryMap = Map<string, Advisory[]>

/**
 * Result of cargo-deny check
 */
export interface CargoDenyResult {
  /** Whether cargo-deny is available */
  available: boolean
  /** Map of package names to their advisories */
  advisories: AdvisoryMap
  /** Error message if cargo-deny failed */
  error?: string
}

/**
 * Raw diagnostic from cargo-deny JSON output
 */
interface CargoDenyDiagnostic {
  type: 'diagnostic' | 'log' | 'summary'
  fields: {
    code?: string
    message?: string
    severity?: 'error' | 'warning'
    advisory?: {
      id: string
      title: string
      description: string
      url: string | null
      package: string
      aliases?: string[]
    }
    notes?: string[]
    labels?: Array<{
      span: string
      message: string
    }>
  }
}

/**
 * Check if cargo-deny is installed
 */
export async function isCargoDenyAvailable(): Promise<boolean> {
  try {
    await execAsync('cargo deny --version')
    return true
  } catch {
    return false
  }
}

/**
 * Parse the package name and version from a cargo-deny label span
 * Example: "openssl 0.9.24 registry+https://github.com/rust-lang/crates.io-index"
 */
function parsePackageFromSpan(span: string): string | null {
  const match = span.match(/^([^\s]+)\s+/)
  return match?.[1] ?? null
}

/**
 * Extract solution from notes array
 */
function extractSolution(notes: string[]): string | null {
  for (const note of notes) {
    if (note.startsWith('Solution:')) {
      return note.replace('Solution:', '').trim()
    }
  }
  return null
}

/**
 * Map cargo-deny code to advisory kind
 */
function codeToKind(code: string): AdvisoryKind {
  switch (code) {
    case 'vulnerability':
      return 'vulnerability'
    case 'unmaintained':
      return 'unmaintained'
    case 'unsound':
      return 'unsound'
    case 'notice':
      return 'notice'
    case 'yanked':
      return 'yanked'
    default:
      return 'vulnerability'
  }
}

/**
 * Run cargo-deny advisories check on a Cargo.toml file
 */
export async function checkAdvisories(cargoTomlPath: string, logger?: Logger): Promise<CargoDenyResult> {
  const available = await isCargoDenyAvailable()
  if (!available) {
    logger?.debug('cargo-deny is not installed')
    return { available: false, advisories: new Map() }
  }

  const manifestDir = path.dirname(cargoTomlPath)
  const advisories: AdvisoryMap = new Map()

  try {
    // Run cargo-deny with JSON output
    // Note: cargo-deny outputs to stderr and returns exit code 1 if there are issues
    const { stdout, stderr } = await execAsync(
      `cargo deny --manifest-path "${cargoTomlPath}" --format json check advisories`,
      {
        cwd: manifestDir,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
      },
    ).catch((err) => {
      // cargo-deny returns non-zero exit code when issues are found
      // but still outputs valid JSON
      return { stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
    })

    // cargo-deny outputs JSON lines (one JSON object per line)
    const output = stderr || stdout
    const lines = output.split('\n').filter((line: string) => line.trim())

    for (const line of lines) {
      try {
        const diagnostic: CargoDenyDiagnostic = JSON.parse(line)

        if (diagnostic.type !== 'diagnostic' || !diagnostic.fields.advisory) {
          continue
        }

        const { advisory, code, message, severity, notes, labels } = diagnostic.fields

        // Get package name from advisory or from labels span
        let packageName = advisory.package
        if (!packageName && labels?.[0]?.span) {
          packageName = parsePackageFromSpan(labels[0].span) ?? ''
        }

        if (!packageName) {
          continue
        }

        const advisoryInfo: Advisory = {
          id: advisory.id,
          title: advisory.title || message || 'Unknown advisory',
          description: advisory.description || '',
          url: advisory.url,
          kind: codeToKind(code ?? 'vulnerability'),
          severity: severity ?? 'error',
          solution: notes ? extractSolution(notes) : null,
          aliases: advisory.aliases ?? [],
        }

        const existing = advisories.get(packageName) ?? []
        // Avoid duplicates by checking ID
        if (!existing.some((a) => a.id === advisoryInfo.id)) {
          existing.push(advisoryInfo)
          advisories.set(packageName, existing)
        }
      } catch {
        // Skip invalid JSON lines
        logger?.debug(`Failed to parse cargo-deny output line: ${line}`)
      }
    }

    logger?.info(`cargo-deny found advisories for ${advisories.size} packages`)
    return { available: true, advisories }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger?.warn(`cargo-deny check failed: ${errorMessage}`)
    return { available: true, advisories: new Map(), error: errorMessage }
  }
}

/**
 * Format advisories for display in hover message
 */
export function formatAdvisoriesForHover(advisories: Advisory[]): string {
  if (advisories.length === 0) {
    return ''
  }

  const lines: string[] = []
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('**Security Advisories:**')

  for (const advisory of advisories) {
    const kindEmoji = getAdvisoryEmoji(advisory.kind)
    const severityLabel = advisory.severity === 'error' ? '**ERROR**' : 'warning'

    lines.push('')
    if (advisory.url) {
      lines.push(`${kindEmoji} [${advisory.id}](${advisory.url}) (${severityLabel})`)
    } else {
      lines.push(`${kindEmoji} ${advisory.id} (${severityLabel})`)
    }
    lines.push(`> ${advisory.title}`)

    if (advisory.solution) {
      lines.push(``)
      lines.push(`**Solution:** ${advisory.solution}`)
    }
  }

  return lines.join('\n')
}

/**
 * Get emoji for advisory kind
 */
export function getAdvisoryEmoji(kind: AdvisoryKind): string {
  switch (kind) {
    case 'vulnerability':
      return '🚨'
    case 'unmaintained':
      return '⚠️'
    case 'unsound':
      return '💀'
    case 'notice':
      return 'ℹ️'
    case 'yanked':
      return '🗑️'
    default:
      return '⚠️'
  }
}

/**
 * Symbol to show in decoration for packages with advisories
 */
export const SYMBOL_ADVISORY = '🚨'
