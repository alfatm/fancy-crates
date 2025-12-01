#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { Command } from 'commander'

import type { DependencyValidationResult, RegistryConfig, ValidatorConfig } from '../core/index.js'
import {
  DEFAULT_CONFIG,
  DOCS_RS_URL,
  formatDependencyResult,
  loadCargoConfig,
  mergeRegistries,
  validateCargoToml,
} from '../core/index.js'

/**
 * Format a single dependency result for CLI output.
 * Uses the same formatting as VSCode extension.
 */
function formatResult(result: DependencyValidationResult, lineContent: string, showHover: boolean): string {
  const { decoration, hoverMarkdown } = formatDependencyResult(result, DOCS_RS_URL.toString())
  const line = result.dependency.line + 1
  const registry = result.dependency.registry ? ` (${result.dependency.registry})` : ''

  const output = [`L${line}: ${lineContent.trim()}${registry}    ${decoration}`]

  if (showHover) {
    output.push('', 'Hover info:', hoverMarkdown, '', '─'.repeat(50))
  }

  return output.join('\n')
}

function parseRegistry(value: string, previous: RegistryConfig[]): RegistryConfig[] {
  const parts = value.split('=')
  const name = parts[0]
  const index = parts.slice(1).join('=') // Handle URLs with = in them
  if (name && index) {
    previous.push({ name, index })
  }
  return previous
}

interface Options {
  filter?: string
  line?: string
  showPlugin: boolean
  cache: boolean
  json: boolean
  registry: RegistryConfig[]
}

const program = new Command()

program
  .name('sparse-crates-cli')
  .description('Validate Cargo.toml dependencies and check for updates')
  .argument('<path>', 'Path to Cargo.toml file')
  .option('--filter <name>', 'Filter by dependency name (can be partial match)')
  .option('--line <num>', 'Filter by line number')
  .option('--show-plugin', 'Show output as VSCode plugin would display it', false)
  .option('--no-cache', 'Disable Cargo cache lookup')
  .option('--json', 'Output results as JSON', false)
  .option(
    '--registry <name=url>',
    'Add alternate registry (format: name=index_url). Overrides registries from cargo config.',
    parseRegistry,
    []
  )
  .addHelpText(
    'after',
    `
Registries are automatically loaded from cargo config (cargo config get registries).
Use --registry to override or add additional registries.

Examples:
  $ sparse-crates-cli ./Cargo.toml
  $ sparse-crates-cli ./Cargo.toml --filter external2 --show-plugin
  $ sparse-crates-cli ./Cargo.toml --line 38 --show-plugin
  $ sparse-crates-cli ./Cargo.toml --no-cache
  $ sparse-crates-cli ./Cargo.toml --registry public-registry=http://localhost:8000/api/v1/crates/`
  )
  .action(main)

async function main(pathArg: string, options: Options) {
  const filePath = resolve(pathArg)
  const useCache = options.cache
  const jsonOutput = options.json
  const showPlugin = options.showPlugin
  const filterName = options.filter
  const filterLine = options.line ? Number.parseInt(options.line, 10) : undefined
  const cliRegistries = options.registry

  // Load cargo config (registries and source replacement)
  const cargoDir = dirname(filePath)
  const cargoConfigResult = await loadCargoConfig(cargoDir)
  if (cargoConfigResult instanceof Error) {
    console.warn(`Warning: ${cargoConfigResult.message}`)
  }

  // Extract registries and source replacement from cargo config
  const cargoConfig = cargoConfigResult instanceof Error ? { registries: [] } : cargoConfigResult

  // Merge registries: CLI args override cargo config
  const registries = mergeRegistries(cargoConfig.registries, cliRegistries)

  // Build source replacement config if crates-io is replaced
  const sourceReplacement = cargoConfig.sourceReplacement
    ? { index: cargoConfig.sourceReplacement.index, token: cargoConfig.sourceReplacement.token }
    : undefined

  const config: ValidatorConfig = {
    ...DEFAULT_CONFIG,
    useCargoCache: useCache,
    registries,
    sourceReplacement,
  }

  // Read file content for line display
  let fileLines: string[] = []
  try {
    fileLines = readFileSync(filePath, 'utf-8').split('\n')
  } catch {
    // ignore
  }

  console.log(`Validating: ${filePath}`)
  console.log(`Cache: ${useCache ? 'enabled' : 'disabled'}`)
  if (sourceReplacement) {
    console.log(`Mirror: crates.io -> ${sourceReplacement.index}`)
  }
  if (registries.length > 0) {
    console.log(`Registries: ${registries.map((r) => r.name).join(', ')}`)
  }
  if (filterName) {
    console.log(`Filter: name contains "${filterName}"`)
  }
  if (filterLine) {
    console.log(`Filter: line ${filterLine}`)
  }
  console.log('')

  try {
    const result = await validateCargoToml(filePath, config)

    if (result.parseError) {
      console.error(`Parse error: ${result.parseError.message}`)
      process.exit(1)
    }

    // Apply filters
    let deps = result.dependencies
    if (filterName) {
      const filter = filterName.toLowerCase()
      deps = deps.filter((d) => d.dependency.name.toLowerCase().includes(filter))
    }
    if (filterLine) {
      deps = deps.filter((d) => d.dependency.line + 1 === filterLine)
    }

    if (deps.length === 0) {
      console.log('No dependencies match the filter.')
      process.exit(0)
    }

    const outdated = deps.filter((d) => d.status === 'outdated')
    const errors = deps.filter((d) => d.status === 'error')
    const upToDate = deps.filter((d) => d.status === 'up-to-date')

    if (jsonOutput) {
      console.log(JSON.stringify({ ...result, dependencies: deps }, null, 2))
    } else {
      console.log(`Found ${deps.length} dependencies:\n`)

      if (upToDate.length > 0) {
        console.log(`Up to date (${upToDate.length}):`)
        for (const r of upToDate) {
          const lineContent = fileLines[r.dependency.line] || ''
          console.log(formatResult(r, lineContent, showPlugin))
        }
        console.log('')
      }

      if (outdated.length > 0) {
        console.log(`Outdated (${outdated.length}):`)
        for (const r of outdated) {
          const lineContent = fileLines[r.dependency.line] || ''
          console.log(formatResult(r, lineContent, showPlugin))
        }
        console.log('')
      }

      if (errors.length > 0) {
        console.log(`Errors (${errors.length}):`)
        for (const r of errors) {
          const lineContent = fileLines[r.dependency.line] || ''
          console.log(formatResult(r, lineContent, showPlugin))
        }
        console.log('')
      }

      console.log('---')
      console.log(`Summary: ${upToDate.length} up-to-date, ${outdated.length} outdated, ${errors.length} errors`)
    }

    // Exit with error code if there are outdated deps or errors
    if (errors.length > 0) {
      process.exit(2)
    }
    if (outdated.length > 0) {
      process.exit(1)
    }
  } catch (err) {
    console.error(`Error: ${err}`)
    process.exit(1)
  }
}

program.parse()
