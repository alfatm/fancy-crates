import {
  type DecorationOptions,
  MarkdownString,
  type Progress,
  type TextEditor,
  type TextEditorDecorationType,
  ThemeColor,
  window,
} from 'vscode'
import {
  type AdvisoryMap,
  checkAdvisories,
  type DependencyValidationResult,
  DOCS_RS_URL,
  findCargoLockPath,
  formatAdvisoriesForHover,
  formatDependencyResult,
  readCargoLockfile,
  SYMBOL_ADVISORY,
  validateCargoTomlContent,
} from '../core/index'
import type { DependencyStatus, ValidatorConfig } from '../core/types'
import { buildValidatorConfig, loadConfigForScope, VSCODE_USER_AGENT } from './config'
import log from './log'

/** All dependency statuses - single source of truth */
const ALL_STATUSES: DependencyStatus[] = ['latest', 'patch-behind', 'minor-behind', 'major-behind', 'error']

/** Theme colors for each status */
const STATUS_COLORS: Record<DependencyStatus, string> = {
  latest: 'editorInfo.foreground',
  'patch-behind': 'editorWarning.foreground',
  'minor-behind': 'editorWarning.foreground',
  'major-behind': 'editorError.foreground',
  error: 'editorError.foreground',
}

/** Lazily initialized decoration types */
let decorationTypes: Record<DependencyStatus, TextEditorDecorationType> | null = null

/** Get or create decoration types (lazy initialization) */
function getDecorationTypes(): Record<DependencyStatus, TextEditorDecorationType> {
  if (!decorationTypes) {
    decorationTypes = Object.fromEntries(
      ALL_STATUSES.map((status) => [
        status,
        window.createTextEditorDecorationType({
          after: {
            margin: '2em',
            color: new ThemeColor(STATUS_COLORS[status]),
          },
        }),
      ]),
    ) as Record<DependencyStatus, TextEditorDecorationType>
  }
  return decorationTypes
}

/** Dispose all decoration types - call on extension deactivation */
export function disposeDecorations() {
  if (decorationTypes) {
    for (const status of ALL_STATUSES) {
      decorationTypes[status].dispose()
    }
    decorationTypes = null
  }
}

/** Commands that hover links are allowed to run */
const HOVER_ENABLED_COMMANDS = ['fancy-crates.updateDependency']

/** Build decoration options for a single dependency */
function buildDecorationOptions(
  editor: TextEditor,
  depResult: DependencyValidationResult,
  fileName: string,
  docsUrl: string,
  advisories: AdvisoryMap,
): { status: DependencyStatus; options: DecorationOptions } {
  const { status, decoration, hoverMarkdown, updateVersion } = formatDependencyResult(depResult, docsUrl)
  const crateName = depResult.dependency.name

  // Check if this crate has security advisories
  const crateAdvisories = advisories.get(crateName) ?? []
  const hasAdvisories = crateAdvisories.length > 0

  // Build hover message with optional update command and advisories
  const hoverMessage = new MarkdownString(hoverMarkdown)
  // Only allow our own command, so that values from Cargo.toml can never run arbitrary commands
  hoverMessage.isTrusted = { enabledCommands: HOVER_ENABLED_COMMANDS }

  // Add update button if there's a newer version available
  if (updateVersion && depResult.dependency.source.type === 'registry') {
    const commandArgs = encodeURIComponent(
      JSON.stringify({
        filePath: fileName,
        line: depResult.dependency.line,
        newVersion: updateVersion,
        crateName: crateName,
      }),
    )
    hoverMessage.appendMarkdown(
      `\n\n[⬆️ Update to ${updateVersion}](command:fancy-crates.updateDependency?${commandArgs})`,
    )
  }

  // Add advisory information to hover if present
  if (hasAdvisories) {
    hoverMessage.appendMarkdown(formatAdvisoriesForHover(crateAdvisories))
  }

  // Add advisory emoji to decoration if there are security issues
  const finalDecoration = hasAdvisories ? `${SYMBOL_ADVISORY} ${decoration}` : decoration

  return {
    status,
    options: {
      range: editor.document.lineAt(depResult.dependency.line).range,
      hoverMessage,
      renderOptions: {
        after: {
          contentText: finalDecoration,
        },
      },
    },
  }
}

/** Apply decorations to editor grouped by status */
function applyDecorations(
  editor: TextEditor,
  dependencies: DependencyValidationResult[],
  fileName: string,
  docsUrl: string,
  advisories: AdvisoryMap,
) {
  const decorationsByStatus = Object.fromEntries(
    ALL_STATUSES.map((status) => [status, [] as DecorationOptions[]]),
  ) as Record<DependencyStatus, DecorationOptions[]>

  const lineCount = editor.document.lineCount
  for (const depResult of dependencies) {
    // The document may have been edited while validation was running
    if (depResult.dependency.line >= lineCount) {
      continue
    }
    const { status, options } = buildDecorationOptions(editor, depResult, fileName, docsUrl, advisories)
    decorationsByStatus[status].push(options)
  }

  // Apply decorations for each status (clear empty ones too to remove stale decorations)
  const types = getDecorationTypes()
  for (const status of ALL_STATUSES) {
    editor.setDecorations(types[status], decorationsByStatus[status])
  }
}

/** Remove all decorations from the editor */
function clearDecorations(editor: TextEditor) {
  const types = getDecorationTypes()
  for (const status of ALL_STATUSES) {
    editor.setDecorations(types[status], [])
  }
}

/** Track pending advisory checks per editor to allow cancellation */
const pendingAdvisoryChecks = new Map<TextEditor, AbortController>()

/** Cancel any pending advisory check for an editor */
export function cancelPendingAdvisoryCheck(editor: TextEditor): void {
  const controller = pendingAdvisoryChecks.get(editor)
  if (controller) {
    controller.abort()
    pendingAdvisoryChecks.delete(editor)
  }
}

/** Progress reporter type for decorate function */
export type ProgressReporter = Progress<{ message?: string }>

/** Extract short display name from full file path */
const getDisplayPath = (filePath: string): string => {
  // Show parent directory + filename for context (e.g., "my-crate/Cargo.toml")
  const parts = filePath.split(/[/\\]/)
  const len = parts.length
  return len >= 2 ? `${parts[len - 2]}/${parts[len - 1]}` : (parts[len - 1] ?? filePath)
}

export async function decorate(editor: TextEditor, signal?: AbortSignal, progress?: ProgressReporter): Promise<void> {
  const filePath = editor.document.fileName
  const displayPath = getDisplayPath(filePath)
  const scope = editor.document.uri
  const start = Date.now()

  log.info(`[${displayPath}] Starting dependency validation`)

  // Cancel any pending advisory check for this editor
  cancelPendingAdvisoryCheck(editor)

  // Check if already aborted
  if (signal?.aborted) {
    log.debug(`[${displayPath}] Aborted before start`)
    return
  }

  // Load cargo registries before processing dependencies
  progress?.report({ message: 'Loading config...' })
  await loadConfigForScope(scope)

  if (signal?.aborted) {
    log.debug(`[${displayPath}] Aborted after config load`)
    return
  }

  // Build validator config from extension settings
  const baseConfig = buildValidatorConfig(scope)
  const config: ValidatorConfig = {
    ...baseConfig,
    fetchOptions: {
      ...baseConfig.fetchOptions,
      logger: log,
      userAgent: VSCODE_USER_AGENT,
    },
  }

  // Load Cargo.lock if available
  progress?.report({ message: 'Reading Cargo.lock...' })
  const lockPath = await findCargoLockPath(filePath)
  const lockfile = lockPath ? readCargoLockfile(lockPath) : undefined
  if (lockPath) {
    log.debug(`[${displayPath}] Using lockfile: ${getDisplayPath(lockPath)}`)
  } else {
    log.debug(`[${displayPath}] No Cargo.lock found`)
  }

  if (signal?.aborted) {
    log.debug(`[${displayPath}] Aborted after lockfile load`)
    return
  }

  // Validate versions
  progress?.report({ message: 'Validating dependencies...' })
  const result = await validateCargoTomlContent(editor.document.getText(), filePath, config, lockfile)

  if (signal?.aborted) {
    log.debug(`[${displayPath}] Aborted after validation`)
    return
  }

  if (result.parseError) {
    log.error(`[${displayPath}] TOML parse error: ${result.parseError.message}`)
    // Line numbers of old decorations are no longer reliable
    clearDecorations(editor)
    return
  }

  const docsUrl = DOCS_RS_URL.toString()
  const emptyAdvisories: AdvisoryMap = new Map()

  // Show decorations immediately without advisories
  const depCount = result.dependencies.length
  progress?.report({ message: `Decorated ${depCount} dependencies` })
  applyDecorations(editor, result.dependencies, filePath, docsUrl, emptyAdvisories)

  const elapsed = ((Date.now() - start) / 1000).toFixed(2)
  log.info(`[${displayPath}] Decorated ${depCount} dependencies in ${elapsed}s`)

  // Create abort controller for advisory check
  const advisoryController = new AbortController()
  pendingAdvisoryChecks.set(editor, advisoryController)

  // Link parent signal to advisory controller
  if (signal) {
    signal.addEventListener('abort', () => advisoryController.abort(), { once: true })
  }

  // Run cargo-deny in background and update decorations when done
  checkAdvisories(filePath, log, advisoryController.signal)
    .then((advisoryResult) => {
      // Check if aborted
      if (advisoryController.signal.aborted) {
        log.debug(`[${displayPath}] Advisory check cancelled`)
        return
      }

      // Verify editor is still valid and document unchanged
      if (editor.document.isClosed || editor.document.fileName !== filePath) {
        log.debug(`[${displayPath}] Editor changed, skipping advisory update`)
        return
      }

      const advisories: AdvisoryMap = advisoryResult.advisories
      if (advisoryResult.available) {
        if (advisoryResult.error) {
          log.warn(`[${displayPath}] cargo-deny error: ${advisoryResult.error}`)
        } else if (advisories.size > 0) {
          log.info(`[${displayPath}] Found ${advisories.size} packages with security advisories`)
          applyDecorations(editor, result.dependencies, filePath, docsUrl, advisories)
        } else {
          log.debug(`[${displayPath}] No security advisories found`)
        }
      } else {
        log.debug(`[${displayPath}] cargo-deny not installed, skipping advisory check`)
      }
    })
    .catch((err) => {
      if (!advisoryController.signal.aborted) {
        log.error(`[${displayPath}] Advisory check failed: ${err instanceof Error ? err.message : err}`)
      }
    })
    .finally(() => {
      // Clean up tracking
      if (pendingAdvisoryChecks.get(editor) === advisoryController) {
        pendingAdvisoryChecks.delete(editor)
      }
    })
}
