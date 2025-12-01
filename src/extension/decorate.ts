import { type DecorationOptions, MarkdownString, type TextEditor, window } from 'vscode'
import { DOCS_RS_URL, formatDependencyResult, validateCargoTomlContent } from '../core/index.js'
import type { ValidatorConfig } from '../core/types.js'
import { buildValidatorConfig, loadConfigForScope, VSCODE_USER_AGENT } from './config.js'
import log from './log.js'

const DECORATION_TYPE = window.createTextEditorDecorationType({
  after: {
    margin: '2em',
  },
})

export async function decorate(editor: TextEditor) {
  const fileName = editor.document.fileName
  log.info(`${fileName} - decorating file`)
  const scope = editor.document.uri
  const start = Date.now()

  // Load cargo registries before processing dependencies
  await loadConfigForScope(scope)

  // Build validator config from extension settings
  const baseConfig = buildValidatorConfig(scope)
  const config: ValidatorConfig = {
    ...baseConfig,
    fetchOptions: {
      logger: log,
      userAgent: VSCODE_USER_AGENT,
    },
  }

  const result = await validateCargoTomlContent(editor.document.getText(), fileName, config)

  if (result.parseError) {
    log.error(`${fileName} - parse error: ${result.parseError.message}`)
    return
  }

  const docsUrl = DOCS_RS_URL.toString()
  const options: DecorationOptions[] = result.dependencies.map((depResult) => {
    const { decoration, hoverMarkdown } = formatDependencyResult(depResult, docsUrl)
    return {
      range: editor.document.lineAt(depResult.dependency.line).range,
      hoverMessage: new MarkdownString(hoverMarkdown),
      renderOptions: {
        after: {
          contentText: decoration,
        },
      },
    }
  })

  editor.setDecorations(DECORATION_TYPE, options)
  log.info(`${fileName} - file decorated in ${Math.round((Date.now() - start) / 10) / 100} seconds`)
}
