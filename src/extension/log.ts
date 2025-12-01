import { window } from 'vscode'

let outputChannel: ReturnType<typeof window.createOutputChannel> | undefined

function getChannel(): ReturnType<typeof window.createOutputChannel> {
  if (!outputChannel) {
    outputChannel = window.createOutputChannel('Sparse Crates', 'log')
  }
  return outputChannel
}

function info(msg: string) {
  getChannel().appendLine(`${new Date().toISOString()} [info] ${msg}`)
}

function warn(msg: string) {
  getChannel().appendLine(`${new Date().toISOString()} [warn] ${msg}`)
}

function error(msg: string) {
  getChannel().appendLine(`${new Date().toISOString()} [error] ${msg}`)
}

function dispose() {
  outputChannel?.dispose()
  outputChannel = undefined
}

export default {
  info,
  warn,
  error,
  dispose,
}
