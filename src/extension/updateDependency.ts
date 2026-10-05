import path from 'node:path'

import { Range, WorkspaceEdit, window, workspace } from 'vscode'

import { buildNewRequirement } from '../core/format'
import log from './log'

export interface UpdateDependencyArgs {
  /** File path of the Cargo.toml */
  filePath: string
  /** 0-based line number of the dependency */
  line: number
  /** The new version string to set */
  newVersion: string
  /** The crate name (for logging) */
  crateName: string
}

/**
 * Updates a dependency version in a Cargo.toml file.
 * Handles both inline version strings and table-style dependencies.
 */
export async function updateDependencyVersion(args: UpdateDependencyArgs): Promise<void> {
  const { filePath, line, newVersion, crateName } = args

  // The command is invoked from hover links; never touch anything but a Cargo.toml manifest
  if (typeof filePath !== 'string' || path.basename(filePath) !== 'Cargo.toml' || !Number.isInteger(line)) {
    log.warn(`[${crateName}] Refusing to update dependency in ${filePath}`)
    return
  }

  const document = await workspace.openTextDocument(filePath)
  if (line < 0 || line >= document.lineCount) {
    log.warn(`[${crateName}] Line ${line + 1} is out of range`)
    return
  }
  const lineText = document.lineAt(line).text

  // Match version patterns:
  // 1. Inline: `crate = "1.0.0"` or `crate = "^1.0.0"`
  // 2. Table style: `version = "1.0.0"` or `version = "^1.0.0"`
  // 3. Inline object: `crate = { version = "1.0.0", ... }`
  const versionPatterns = [
    // version = "X.Y.Z" (table style or inline object)
    /(\bversion\s*=\s*")([^"]+)(")/,
    // crate = "X.Y.Z" (simple inline, but not if it looks like a table)
    /^(\s*[a-zA-Z0-9_-]+\s*=\s*")([^"]+)(")\s*$/,
  ]

  let match: RegExpExecArray | null = null

  for (const p of versionPatterns) {
    match = p.exec(lineText)
    if (match) {
      break
    }
  }

  const prefix = match?.[1]
  const version = match?.[2]

  if (!match || prefix === undefined || version === undefined) {
    log.warn(`[${crateName}] Could not find version pattern on line ${line + 1}`)
    window.showWarningMessage(`Could not find version to update for ${crateName}`)
    return
  }

  const matchIndex = match.index ?? 0
  const startCol = matchIndex + prefix.length
  const endCol = startCol + version.length
  const replacement = buildNewRequirement(version, newVersion)

  // Remember whether the user has unsaved changes before we edit the document
  const wasDirty = document.isDirty

  const edit = new WorkspaceEdit()
  const range = new Range(line, startCol, line, endCol)
  edit.replace(document.uri, range, replacement)

  const success = await workspace.applyEdit(edit)

  if (success) {
    log.info(`[${crateName}] Updated version: ${version} -> ${replacement}`)
    if (wasDirty) {
      // Do not save the user's unrelated unsaved changes; decorations refresh on their next save
      log.debug(`[${crateName}] Document has unsaved changes, not saving automatically`)
    } else {
      // Save the document to trigger re-decoration
      await document.save()
    }
  } else {
    log.error(`[${crateName}] Failed to update version to ${newVersion}`)
    window.showErrorMessage(`Failed to update ${crateName}`)
  }
}
