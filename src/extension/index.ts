import path from 'node:path'

import { commands, type ExtensionContext, ProgressLocation, type TextEditor, window, workspace } from 'vscode'
import packageJson from '../../package.json' with { type: 'json' }
import { clearVersionsCache, resetCargoDenyCache, resetCliToolsCache } from '../core/index'
import { clearCargoConfigCache } from './config'
import { cancelPendingAdvisoryCheck, decorate, disposeDecorations } from './decorate'
import log from './log'
import { type UpdateDependencyArgs, updateDependencyVersion } from './updateDependency'

/** Track decorated editors to avoid redundant decoration */
const decoratedEditors = new Set<TextEditor>()

/** Track pending decoration operations per editor (the same file may be open in several editors) */
const pendingDecorations = new Map<TextEditor, AbortController>()

/** Extract short display name from full file path */
const getDisplayPath = (filePath: string): string => {
  const parts = filePath.split(/[/\\]/)
  const len = parts.length
  return len >= 2 ? `${parts[len - 2]}/${parts[len - 1]}` : (parts[len - 1] ?? filePath)
}

export function activate(context: ExtensionContext) {
  log.info(`Extension activated (v${packageJson.version})`)

  // Register command to manually refresh decorations
  const refreshCommand = commands.registerCommand('fancy-crates.refresh', () => {
    refreshAllCargoToml()
  })

  // Register command to reload current file with full cache clear
  const reloadCommand = commands.registerCommand('fancy-crates.reload', () => {
    reloadCurrentFile()
  })

  // Register command to update a dependency to a specific version
  const updateCommand = commands.registerCommand('fancy-crates.updateDependency', (args: UpdateDependencyArgs) => {
    updateDependencyVersion(args)
  })

  // Decorate files when they are first opened
  const visibleEditorsListener = window.onDidChangeVisibleTextEditors((editors) => {
    // Clean up editors that are no longer visible
    for (const editor of decoratedEditors) {
      if (!editors.includes(editor)) {
        decoratedEditors.delete(editor)
        cancelPendingDecoration(editor)
      }
    }

    // Decorate new Cargo.toml editors
    for (const editor of editors) {
      if (isCargoToml(editor) && !decoratedEditors.has(editor)) {
        decoratedEditors.add(editor)
        decorateWithProgress(editor)
      }
    }
  })

  // Decorate files when their changes are saved
  const saveListener = workspace.onDidSaveTextDocument((document) => {
    for (const editor of window.visibleTextEditors) {
      if (editor.document === document && isCargoToml(editor)) {
        decorateWithProgress(editor)
      }
    }
  })

  // Listen for configuration changes
  const configListener = workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('fancy-crates.logLevel')) {
      log.updateLogLevel()
    }
    if (e.affectsConfiguration('fancy-crates') && !e.affectsConfiguration('fancy-crates.logLevel')) {
      log.info('Settings changed, refreshing all Cargo.toml files')
      clearCargoConfigCache()
      refreshAllCargoToml()
    }
  })

  // Watch for .cargo/config.toml changes to invalidate cargo config cache
  const cargoConfigWatcher = workspace.createFileSystemWatcher('**/.cargo/config.toml')
  const onCargoConfigChange = () => {
    log.info('Cargo config changed (.cargo/config.toml), refreshing all files')
    clearCargoConfigCache()
    refreshAllCargoToml()
  }
  cargoConfigWatcher.onDidChange(onCargoConfigChange)
  cargoConfigWatcher.onDidCreate(onCargoConfigChange)
  cargoConfigWatcher.onDidDelete(onCargoConfigChange)

  // Register all disposables
  context.subscriptions.push(
    refreshCommand,
    reloadCommand,
    updateCommand,
    visibleEditorsListener,
    saveListener,
    configListener,
    cargoConfigWatcher,
    {
      dispose: () => {
        decoratedEditors.clear()
        for (const controller of pendingDecorations.values()) {
          controller.abort()
        }
        pendingDecorations.clear()
        log.dispose()
      },
    },
  )

  // Decorate already visible Cargo.toml files on activation
  for (const editor of window.visibleTextEditors) {
    if (isCargoToml(editor)) {
      decoratedEditors.add(editor)
      decorateWithProgress(editor)
    }
  }
}

export function deactivate() {
  disposeDecorations()
}

function isCargoToml(editor: TextEditor): boolean {
  return path.basename(editor.document.fileName) === 'Cargo.toml'
}

function cancelPendingDecoration(editor: TextEditor) {
  const controller = pendingDecorations.get(editor)
  if (controller) {
    controller.abort()
    pendingDecorations.delete(editor)
  }
  // Also cancel any pending advisory check
  cancelPendingAdvisoryCheck(editor)
}

async function decorateWithProgress(editor: TextEditor): Promise<void> {
  const fileName = editor.document.fileName

  // Cancel any pending decoration for this editor
  cancelPendingDecoration(editor)

  const controller = new AbortController()
  pendingDecorations.set(editor, controller)

  try {
    await window.withProgress(
      {
        location: ProgressLocation.Window,
        title: 'Fancy Crates',
      },
      async (progress) => {
        if (controller.signal.aborted) {
          return
        }
        await decorate(editor, controller.signal, progress)
      },
    )
  } catch (err) {
    if (!controller.signal.aborted) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`[${getDisplayPath(fileName)}] Decoration failed: ${message}`)
      window.showErrorMessage(`Fancy Crates: Failed to check dependencies. See output for details.`)
    }
  } finally {
    if (pendingDecorations.get(editor) === controller) {
      pendingDecorations.delete(editor)
    }
  }
}

function refreshAllCargoToml() {
  for (const editor of window.visibleTextEditors) {
    if (isCargoToml(editor)) {
      decorateWithProgress(editor)
    }
  }
}

function reloadCurrentFile() {
  // Clear all caches
  clearCargoConfigCache()
  clearVersionsCache()
  resetCliToolsCache()
  resetCargoDenyCache()

  log.info('Caches cleared (versions, cargo config, CLI tools, cargo-deny), reloading files')

  // Reload the active editor if it's a Cargo.toml
  const activeEditor = window.activeTextEditor
  if (activeEditor && isCargoToml(activeEditor)) {
    decorateWithProgress(activeEditor)
  } else {
    // Reload all visible Cargo.toml files
    refreshAllCargoToml()
  }
}
